import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import {
	Cause,
	type Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Logger,
	Result,
} from "effect";
import { buildCpp } from "../scripts/cpp.ts";
import { ContractMismatch, CustomCatCli } from "../src/server/custom-cat.ts";
import { CliFailed } from "../src/shared/cli-failed.ts";
import { CustomCat, IoFailed } from "../src/shared/generated/protocol.ts";

const directory = mkdtempSync(join(tmpdir(), "custom-cat-cli-"));

const layerOf = (options: { binary?: string; timeout?: Duration.Input }) =>
	CustomCatCli.layerWith({ directory, ...options }).pipe(
		Layer.provide(BunServices.layer),
	);

const run = (
	request: CustomCat.Request,
	options: { binary?: string; timeout?: Duration.Input } = {},
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* CustomCatCli).run(request);
		}).pipe(Effect.result, Effect.provide(layerOf(options))),
	);

const request = { inputFile: "hello.txt", outputFile: "copy.txt" };

/** An executable shell script in the test's directory, standing in for custom_cat. */
async function script(name: string, body: string) {
	const path = join(directory, name);
	await Bun.write(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}

const pidFile = join(directory, "pid");

/** Waits for the stand-in to write its pid, then returns it. */
async function startedPid() {
	for (let tries = 0; tries < 500; tries++) {
		const file = Bun.file(pidFile);
		if (await file.exists()) {
			const text = (await file.text()).trim();
			if (text !== "") return Number(text);
		}
		await Bun.sleep(10);
	}
	throw new Error("the script never wrote its pid");
}

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** Whether `pid` is gone within a second. */
async function goneSoon(pid: number) {
	for (let tries = 0; tries < 100; tries++) {
		if (!alive(pid)) return true;
		await Bun.sleep(10);
	}
	return false;
}

describe.skipIf(Bun.which("cmake") === null)("CustomCatCli", () => {
	beforeAll(async () => {
		buildCpp();
		await Bun.write(join(directory, "files/hello.txt"), "Hello\n");
	}, 600_000);
	afterAll(() => rmSync(directory, { recursive: true, force: true }));

	test("succeeds with what custom_cat printed", async () => {
		const result = await run(request);
		expect(result).toEqual(Result.succeed({ bytesCopied: 6 }));
		expect(await Bun.file(join(directory, "files/copy.txt")).text()).toBe(
			"Hello\n",
		);
	});

	test("fails with the generated InvalidRequest, every issue in it", async () => {
		const result = await run({
			inputFile: "missing.txt",
			outputFile: "copy.json",
		});
		expect(result).toEqual(
			Result.fail(
				new CustomCat.InvalidRequest({
					issues: [
						{
							message: '"missing.txt" does not exist',
							path: ["inputFile"],
						},
						{
							message: '"copy.json" is not a .txt file',
							path: ["outputFile"],
						},
					],
				}),
			),
		);
		expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
			CustomCat.InvalidRequest,
		);
	});

	test("fails with IoFailed when custom_cat can't read or write", async () => {
		mkdirSync(join(directory, "files/dir.txt"));
		const result = await run({
			inputFile: "dir.txt",
			outputFile: "copy.txt",
		});
		expect(result).toEqual(
			Result.fail(
				new IoFailed({
					operation: "read",
					file: "dir.txt",
					reason: "Is a directory",
				}),
			),
		);
		expect(Result.isFailure(result) && result.failure.message).toBe(
			`Couldn't read "dir.txt": Is a directory`,
		);
	});

	describe("fails with CliFailed when custom_cat", () => {
		test("isn't there", async () => {
			const result = await run(request, {
				binary: join(directory, "missing"),
			});
			expect(result).toEqual(
				Result.fail(new CliFailed({ reason: { _tag: "NotFound" } })),
			);
		});

		test("isn't executable", async () => {
			const binary = await script("plain", "exit 0");
			chmodSync(binary, 0o644);
			const result = await run(request, { binary });
			expect(result).toEqual(
				Result.fail(
					new CliFailed({ reason: { _tag: "NotExecutable" } }),
				),
			);
		});

		test("is killed by a signal", async () => {
			const binary = await script("killed", "kill -9 $$");
			const result = await run(request, { binary });
			expect(result).toEqual(
				Result.fail(
					new CliFailed({
						reason: { _tag: "Killed", signal: "SIGKILL" },
					}),
				),
			);
			expect(Result.isFailure(result) && result.failure.message).toBe(
				"custom_cat was killed by SIGKILL",
			);
		});

		test("runs too long, and kills it", async () => {
			rmSync(pidFile, { force: true });
			const binary = await script(
				"sleepy",
				`echo $$ > ${pidFile}\nsleep 30`,
			);
			const pending = run(request, { binary, timeout: "1 second" });
			const pid = await startedPid();
			const result = await pending;
			expect(result).toEqual(
				Result.fail(
					new CliFailed({
						reason: { _tag: "TimedOut", millis: 1000 },
					}),
				),
			);
			expect(Result.isFailure(result) && result.failure.message).toBe(
				"custom_cat didn't finish within 1s",
			);
			expect(await goneSoon(pid)).toBe(true);
		});
	});

	test("kills custom_cat when the call is interrupted", async () => {
		rmSync(pidFile, { force: true });
		const binary = await script("sleepy", `echo $$ > ${pidFile}\nsleep 30`);
		const fiber = Effect.runFork(
			Effect.gen(function* () {
				return yield* (yield* CustomCatCli).run(request);
			}).pipe(Effect.provide(layerOf({ binary, timeout: "1 minute" }))),
		);
		const pid = await startedPid();
		expect(alive(pid)).toBe(true);
		const exit = await Effect.runPromise(
			Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber))),
		);
		expect(
			Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
		).toBe(true);
		expect(await goneSoon(pid)).toBe(true);
	});

	describe("dies with ContractMismatch, logged, when custom_cat", () => {
		/** The exit of a run whose custom_cat is a script, and what was logged. */
		const runScript = async (name: string, body: string) => {
			const logged: Array<{ level: string; message: unknown }> = [];
			const logger = Logger.make(({ logLevel, message }) => {
				logged.push({ level: logLevel, message });
			});
			const exit = await Effect.runPromiseExit(
				Effect.gen(function* () {
					return yield* (yield* CustomCatCli).run(request);
				}).pipe(
					Effect.provide(
						layerOf({ binary: await script(name, body) }),
					),
					Effect.provide(Logger.layer([logger])),
				),
			);
			return { exit, logged };
		};

		const mismatchOf = (exit: Exit.Exit<unknown, unknown>) => {
			expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(
				false,
			);
			const defect = Exit.isFailure(exit) && Cause.squash(exit.cause);
			expect(defect).toBeInstanceOf(ContractMismatch);
			return defect as ContractMismatch;
		};

		test("prints what no schema decodes", async () => {
			const { exit, logged } = await runScript(
				"garbage",
				"echo garbage\nexit 0",
			);
			const defect = mismatchOf(exit);
			expect(defect).toMatchObject({
				exitCode: 0,
				stdout: "garbage\n",
				stderr: "",
			});
			expect(defect.message).toStartWith(
				"custom_cat's output doesn't match the protocol (exit 0): ",
			);
			expect(logged).toContainEqual({
				level: "Error",
				message: [defect.message, defect],
			});
		});

		test("prints another exit code's output", async () => {
			const defect = mismatchOf(
				(await runScript("swapped", `echo '{"bytesCopied":6}'\nexit 1`))
					.exit,
			);
			expect(defect.exitCode).toBe(1);
		});

		test("rejects its arguments", async () => {
			const defect = mismatchOf(
				(await runScript("usage", "echo 'bad flag' >&2\nexit 2")).exit,
			);
			expect(defect.issue).toBe(
				"custom_cat rejected its arguments: bad flag",
			);
		});

		test("exits with a code it doesn't have", async () => {
			const defect = mismatchOf(
				(await runScript("odd", "echo odd >&2\nexit 9")).exit,
			);
			expect(defect.issue).toBe("9 isn't one of custom_cat's exit codes");
		});
	});

	test("dies with a plain defect when custom_cat reports something unexpected", async () => {
		const binary = await script("broken", "echo broken >&2\nexit 4");
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				return yield* (yield* CustomCatCli).run(request);
			}).pipe(Effect.provide(layerOf({ binary }))),
		);
		const defect = Exit.isFailure(exit) && Cause.squash(exit.cause);
		expect(defect).not.toBeInstanceOf(ContractMismatch);
		expect(defect instanceof Error && defect.message).toBe(
			"custom_cat failed: broken",
		);
	});
});
