import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { Effect, Layer, Result } from "effect";
import { HttpRouter } from "effect/http";
import { buildCpp } from "../scripts/cpp.ts";
import { BffReader } from "../src/server/bun-side/bff-reader.ts";
import { CustomCatCli } from "../src/server/cpp-side/custom-cat.ts";
import { RestRoutes } from "../src/server/protocols/rest.ts";
import { IoFailed } from "../src/shared/generated/protocol.ts";
import { ReadFile } from "../src/shared/read-file.ts";

// Effect's own messages, for the rules ReadFile.Request checks.
const notTxt = "Expected a string matching the RegExp ^.+\\.txt$";
const notPlain = String.raw`Expected a string matching the RegExp ^(?!\.\.?$)[^/\\]*$`;

const readIn = (layer: typeof BffReader.layer) => (name: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* BffReader).read(name);
		}).pipe(
			Effect.result,
			Effect.provide(layer.pipe(Layer.provide(BunServices.layer))),
		),
	);

const issuesOf = (result: Result.Result<unknown, ReadFile.Failure>) =>
	Result.isFailure(result) &&
	result.failure._tag === "InvalidRequest" &&
	result.failure.issues;

// Both read the repository's files/.
const read = readIn(BffReader.layer);

const scratch = mkdtempSync(join(tmpdir(), "bff-"));
const readScratch = readIn(BffReader.layerIn(scratch));

const handlers: Array<() => Promise<void>> = [];

/** The REST API over files in `scratch`, custom_cat being `binary`. */
function rest(binary?: string) {
	const { handler, dispose } = HttpRouter.toWebHandler(
		RestRoutes.pipe(
			Layer.provide([
				BffReader.layerIn(scratch),
				CustomCatCli.layerWith({ directory: scratch, binary }),
			]),
			Layer.provide(BunServices.layer),
			Layer.provide(BunHttpServer.layerHttpServices),
		),
		{ disableLogger: true },
	);
	handlers.push(dispose);
	const answer = async (request: Request) => {
		const response = await handler(request);
		return { status: response.status, body: await response.text() };
	};
	return {
		get: (name: string) =>
			answer(new Request(`http://127.0.0.1/api/files/read/${name}`)),
		copy: (payload: object) =>
			answer(
				new Request("http://127.0.0.1/api/files/copy", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				}),
			),
	};
}

const { get, copy } = rest();

/** An executable shell script standing in for custom_cat. */
async function script(name: string, body: string) {
	const path = join(scratch, name);
	await Bun.write(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}

beforeAll(async () => {
	buildCpp();
	await Bun.write(join(scratch, "files/hello.txt"), "Hello\n");
	await Bun.write(join(scratch, "files/config.json"), "{}");
	mkdirSync(join(scratch, "files/dir.txt"));
}, 600_000);

afterAll(async () => {
	for (const dispose of handlers) await dispose();
	rmSync(scratch, { recursive: true, force: true });
});

describe("BffReader", () => {
	test("reads a .txt file", async () => {
		const result = await read("hello.txt");
		expect(Result.isSuccess(result) && result.success.contents).toStartWith(
			"Hello",
		);
	});

	test("fails with an InvalidRequest whose issue is on name", async () => {
		expect(await read("config.json")).toEqual(
			Result.fail(
				new ReadFile.InvalidRequest({
					issues: [{ message: notTxt, path: ["name"] }],
				}),
			),
		);
		expect(issuesOf(await read("x.md"))).toEqual([
			{
				message: "Expected a string with at least 5 code points",
				path: ["name"],
			},
		]);
		expect(issuesOf(await read("missing.txt"))).toEqual([
			{ message: "no such file or directory", path: ["name"] },
		]);
	});
});

describe("BffReader in a files/ of its own", () => {
	test("fails with IoFailed for a directory named x.txt", async () => {
		const result = await readScratch("dir.txt");
		expect(result).toEqual(
			Result.fail(
				new IoFailed({
					operation: "read",
					file: "dir.txt",
					reason: "illegal operation on a directory",
				}),
			),
		);
	});

	test("refuses a link, wherever it leads", async () => {
		await Bun.write(join(scratch, "outside.txt"), "Outside\n");
		symlinkSync(
			join(scratch, "outside.txt"),
			join(scratch, "files/out.txt"),
		);
		symlinkSync("hello.txt", join(scratch, "files/in.txt"));
		for (const name of ["out.txt", "in.txt"]) {
			expect(issuesOf(await readScratch(name))).toEqual([
				{
					message: `"${name}" is a link, which could lead outside the files directory`,
					path: ["name"],
				},
			]);
		}
		expect(await readScratch("hello.txt")).toEqual(
			Result.succeed({ contents: "Hello\n" }),
		);
	});

	test("refuses a path before looking at the files", async () => {
		expect(issuesOf(await readScratch("../outside.txt"))).toEqual([
			{ message: notPlain, path: ["name"] },
		]);
	});
});

describe("REST", () => {
	test("answers a file with its text", async () => {
		const { status, body } = await get("hello.txt");
		expect(status).toBe(200);
		expect(body).toBe("Hello\n");
	});

	test("answers a copy with its success", async () => {
		const { status, body } = await copy({
			inputFile: "hello.txt",
			outputFile: "copy.txt",
		});
		expect(status).toBe(200);
		expect(JSON.parse(body)).toEqual({ bytesCopied: 6 });
	});

	test("answers an InvalidRequest with 422 and its issues", async () => {
		const { status, body } = await get("config.json");
		expect(status).toBe(422);
		expect(JSON.parse(body)).toEqual({
			_tag: "InvalidRequest",
			issues: [{ message: notTxt, path: ["name"] }],
		});
		expect((await get("missing.txt")).status).toBe(422);
		expect(
			(await copy({ inputFile: "hello.txt", outputFile: "hello.txt" }))
				.status,
		).toBe(422);
	});

	test("leaves a copy's rules to custom_cat, its issues as it words them", async () => {
		const both = await copy({ inputFile: "hi", outputFile: "../x.txt" });
		expect(both.status).toBe(422);
		expect(JSON.parse(both.body).issues).toEqual([
			{
				message:
					"Size validation failed: Value expected to be greater than or equal to 5, but got 2.",
				path: ["inputFile"],
			},
			{
				message: String.raw`String '../x.txt' did not match format 'plain file name': '^(?!\.\.?$)[^/\\]*$'.`,
				path: ["outputFile"],
			},
		]);
		expect(await Bun.file(join(scratch, "x.txt")).exists()).toBe(false);
	});

	test("answers a request of the wrong shape with 422 and its issues, before the handler", async () => {
		const wrongType = await copy({ inputFile: 42 });
		expect(wrongType.status).toBe(422);
		expect(JSON.parse(wrongType.body)).toEqual({
			_tag: "InvalidRequest",
			issues: [
				{ message: "Expected string", path: ["inputFile"] },
				{ message: "Missing key", path: ["outputFile"] },
			],
		});
		const unknownField = await copy({
			inputFile: "hello.txt",
			outputFile: "x.txt",
			verbose: true,
		});
		expect(unknownField.status).toBe(422);
		expect(JSON.parse(unknownField.body).issues).toEqual([
			{ message: "verbose: Expected no excess property", path: [] },
		]);
		const notAnObject = await copy([]);
		expect(notAnObject.status).toBe(422);
		expect(JSON.parse(notAnObject.body).issues).toEqual([
			{ message: "Expected object", path: [] },
		]);
		expect(await Bun.file(join(scratch, "files/x.txt")).exists()).toBe(
			false,
		);
	});

	test("answers IoFailed with 500 and its JSON", async () => {
		const { status, body } = await get("dir.txt");
		expect(status).toBe(500);
		expect(JSON.parse(body)).toEqual({
			_tag: "IoFailed",
			operation: "read",
			file: "dir.txt",
			reason: "illegal operation on a directory",
		});
		expect(
			(await copy({ inputFile: "dir.txt", outputFile: "copy.txt" }))
				.status,
		).toBe(500);
	});

	test("answers CliFailed with 503 and its JSON", async () => {
		const { status, body } = await rest(join(scratch, "missing")).copy({
			inputFile: "hello.txt",
			outputFile: "copy.txt",
		});
		expect(status).toBe(503);
		expect(JSON.parse(body)).toEqual({
			_tag: "CliFailed",
			reason: { _tag: "NotFound" },
		});
	});

	test("answers a defect with an empty 500", async () => {
		const binary = await script("broken", "echo broken >&2\nexit 4");
		const { status, body } = await rest(binary).copy({
			inputFile: "hello.txt",
			outputFile: "copy.txt",
		});
		expect(status).toBe(500);
		expect(body).toBe("");
	});
});
