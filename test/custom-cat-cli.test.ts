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
	Result,
} from "effect";
import { buildCpp } from "../scripts/cpp.ts";
import { CustomCatCli } from "../src/server/custom-cat.ts";
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
							code: "FileNotFound",
							message: '"missing.txt" does not exist',
							path: ["inputFile"],
						},
						{
							code: "NotTxtFile",
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

	test("dies on an exit custom_cat doesn't document", async () => {
		const binary = await script("odd", "echo odd >&2\nexit 9");
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				return yield* (yield* CustomCatCli).run(request);
			}).pipe(Effect.provide(layerOf({ binary }))),
		);
		expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
		expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(
			"custom_cat exited with 9: odd",
		);
	});
});
