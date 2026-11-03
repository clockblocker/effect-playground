import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Cause, Effect, Exit, Layer, Result } from "effect";
import { buildCpp } from "../scripts/cpp.ts";
import { CustomCatCli } from "../src/server/custom-cat.ts";
import {
	type CustomCat,
	FileNotFound,
	NotTxtFile,
} from "../src/shared/generated/protocol.ts";

const directory = mkdtempSync(join(tmpdir(), "custom-cat-cli-"));

const layer = CustomCatCli.layerIn(directory).pipe(
	Layer.provide(BunServices.layer),
);

const runExit = (request: CustomCat.Request) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			return yield* (yield* CustomCatCli).run(request);
		}).pipe(Effect.provide(layer)),
	);

const run = (request: CustomCat.Request) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* CustomCatCli).run(request);
		}).pipe(Effect.result, Effect.provide(layer)),
	);

describe.skipIf(Bun.which("cmake") === null)("CustomCatCli", () => {
	beforeAll(async () => {
		buildCpp();
		await Bun.write(join(directory, "files/hello.txt"), "Hello\n");
	}, 600_000);
	afterAll(() => rmSync(directory, { recursive: true, force: true }));

	test("succeeds with what custom_cat printed", async () => {
		const result = await run({
			inputFile: "hello.txt",
			outputFile: "copy.txt",
		});
		expect(result).toEqual(Result.succeed({ bytesCopied: 6 }));
		expect(await Bun.file(join(directory, "files/copy.txt")).text()).toBe(
			"Hello\n",
		);
	});

	test("fails with the generated error classes", async () => {
		const notTxt = await run({
			inputFile: "hello.txt",
			outputFile: "copy.json",
		});
		expect(notTxt).toEqual(
			Result.fail(new NotTxtFile({ file: "copy.json" })),
		);
		expect(Result.isFailure(notTxt) && notTxt.failure).toBeInstanceOf(
			NotTxtFile,
		);
		const missing = await run({
			inputFile: "missing.txt",
			outputFile: "copy.txt",
		});
		expect(Result.isFailure(missing) && missing.failure).toBeInstanceOf(
			FileNotFound,
		);
	});

	test("dies on anything but a success or a domain error", async () => {
		// The schema would reject it first; custom_cat exits with 2.
		const exit = await runExit({
			inputFile: "x.md",
			outputFile: "copy.txt",
		});
		expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
		expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(
			"custom_cat exited with 2: custom_cat: Failed to parse field 'input-file'",
		);
	});
});
