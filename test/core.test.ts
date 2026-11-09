import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result, Schema } from "effect";
import { Core } from "../src/server/cpp-side/core.ts";
import { CustomCat, CustomWc } from "../src/shared/generated/generated.ts";
import { runWith, startCore } from "./support/core.ts";

// The operations as the BFF calls them: over JSON-RPC, through Core, of a
// core serving files/ under its own directory.

const directory = mkdtempSync(join(tmpdir(), "core-"));
const files = join(directory, "files");
let core: Awaited<ReturnType<typeof startCore>>;

const copy = (inputFile: string, outputFile: string) =>
	runWith(
		core.layer,
		Effect.gen(function* () {
			return yield* (yield* Core).call((operations) =>
				operations.CustomCat({ inputFile, outputFile }),
			);
		}),
	);

const count = (file: string) =>
	runWith(
		core.layer,
		Effect.gen(function* () {
			return yield* (yield* Core).call((operations) =>
				operations.CustomWc({ file }),
			);
		}),
	);

const write = (name: string, text: string) =>
	Bun.write(join(files, name), text);
const read = (name: string) => Bun.file(join(files, name)).text();
const exists = (name: string) => Bun.file(join(files, name)).exists();

/** The issues of a failure that is an InvalidRequest, as [message, ...path]. */
const issuesOf = (result: Result.Result<unknown, { readonly _tag: string }>) =>
	Result.isFailure(result) && result.failure._tag === "InvalidRequest"
		? (result.failure as CustomCat.InvalidRequest).issues.map(
				({ message, path }) => [message, ...path],
			)
		: result;

// reflect-cpp's own messages, as each rule words them.
const notTxt = (name: string) =>
	`String '${name}' did not match format '.txt file name': '^.+\\.txt$'.`;
const notPlain = (name: string) =>
	`String '${name}' did not match format 'plain file name': '^(?!\\.\\.?$)[^/\\\\]*$'.`;
const tooShort = (size: number) =>
	`Code point count validation failed: Value expected to be greater than or equal to 5, but got ${size}.`;
const tooLong = (size: number) =>
	`Code point count validation failed: Value expected to be less than or equal to 25, but got ${size}.`;

describe.skipIf(Bun.which("cmake") === null)("the core's operations", () => {
	beforeAll(async () => {
		await write("hello.txt", "Hello\n");
		await write("text.txt", "one two\n  three\t four\n\nno newline");
		await write("empty.txt", "");
		mkdirSync(join(files, "folder.txt"));
		core = await startCore(directory);
	}, 600_000);
	afterAll(async () => {
		await core.stop();
		chmodSync(files, 0o755);
		rmSync(directory, { recursive: true, force: true });
	});

	describe("CustomCat", () => {
		test("copies the input to the output, replacing it", async () => {
			expect(await copy("hello.txt", "copy.txt")).toEqual(
				Result.succeed({ bytesCopied: 6 }),
			);
			expect(await read("copy.txt")).toBe("Hello\n");
			await write("long.txt", "something much longer\n");
			expect(await copy("hello.txt", "long.txt")).toEqual(
				Result.succeed({ bytesCopied: 6 }),
			);
			expect(await read("long.txt")).toBe("Hello\n");
		});

		test("reports every field that breaks a name's rule, the first rule each", async () => {
			await write("config.json", "{}");
			expect(issuesOf(await copy("config.json", "x.json"))).toEqual([
				[notTxt("config.json"), "inputFile"],
				[notTxt("x.json"), "outputFile"],
			]);
			expect(await exists("x.json")).toBe(false);
			expect(issuesOf(await copy("x.md", "y.md"))).toEqual([
				[tooShort(4), "inputFile"],
				[tooShort(4), "outputFile"],
			]);
			expect(
				issuesOf(await copy("hello.txt", `${"a".repeat(23)}.txt`)),
			).toEqual([[tooLong(27), "outputFile"]]);
			expect(
				issuesOf(await copy("../files/hello.txt", "../x.txt")),
			).toEqual([
				[notPlain("../files/hello.txt"), "inputFile"],
				[notPlain("../x.txt"), "outputFile"],
			]);
			expect(await Bun.file(join(directory, "x.txt")).exists()).toBe(
				false,
			);
		});

		test("counts a name's code points, not its bytes, as the form does", async () => {
			const formAccepts = Schema.is(CustomCat.Request);
			const cases = [
				// 20 code points, 36 bytes.
				[`${"ä".repeat(16)}.txt`, undefined],
				["äö.t", tooShort(4)],
				[`${"ä".repeat(22)}.txt`, tooLong(26)],
			] as const;
			for (const [name, message] of cases) {
				const result = await copy("hello.txt", name);
				expect(issuesOf(result)).toEqual(
					message === undefined
						? Result.succeed({ bytesCopied: 6 })
						: [[message, "outputFile"]],
				);
				expect(
					formAccepts({ inputFile: "hello.txt", outputFile: name }),
				).toBe(message === undefined);
			}
			expect(Buffer.byteLength(cases[0][0])).toBe(36);
		});

		test("checks the files once the names pass their rules", async () => {
			expect(issuesOf(await copy("missing.txt", "copy.txt"))).toEqual([
				["No such file or directory", "inputFile"],
			]);
			expect(issuesOf(await copy("missing.txt", "copy.json"))).toEqual([
				[notTxt("copy.json"), "outputFile"],
			]);
			expect(issuesOf(await copy("missing.txt", "missing.txt"))).toEqual([
				["No such file or directory", "inputFile"],
			]);
		});

		test("refuses to copy a file onto itself, by name or through a hard link", async () => {
			expect(issuesOf(await copy("hello.txt", "hello.txt"))).toEqual([
				["Must not be the input file", "outputFile"],
			]);
			linkSync(join(files, "hello.txt"), join(files, "same.txt"));
			expect(issuesOf(await copy("hello.txt", "same.txt"))).toEqual([
				[
					'"same.txt" is the input file under another name',
					"outputFile",
				],
			]);
		});

		test("refuses a link in files/, wherever it leads, on every field at once", async () => {
			await write("secret.txt", "Secret\n");
			const outside = join(directory, "outside.txt");
			await Bun.write(outside, "Outside\n");
			symlinkSync(outside, join(files, "out.txt"));
			symlinkSync("secret.txt", join(files, "in.txt"));
			expect(issuesOf(await copy("out.txt", "in.txt"))).toEqual([
				[
					'"out.txt" is a link, which could lead outside the files directory',
					"inputFile",
				],
				[
					'"in.txt" is a link, which could lead outside the files directory',
					"outputFile",
				],
			]);
			expect(await Bun.file(outside).text()).toBe("Outside\n");
		});

		test("fails with IoFailed for a directory named x.txt, or a write the system refuses", async () => {
			mkdirSync(join(files, "dir.txt"));
			expect(await copy("dir.txt", "copy.txt")).toEqual(
				Result.fail(
					new CustomCat.IoFailed({ message: "Is a directory" }),
				),
			);
			mkdirSync(join(files, "taken.txt/inside"), { recursive: true });
			expect(await copy("hello.txt", "taken.txt")).toEqual(
				Result.fail(
					new CustomCat.IoFailed({ message: "Is a directory" }),
				),
			);
			// No temporary file is left behind.
			expect(readdirSync(join(files, "taken.txt"))).toEqual(["inside"]);
			expect(
				readdirSync(files).filter((name) =>
					name.startsWith(".custom_cat-"),
				),
			).toEqual([]);
		});

		test("keeps an overwritten output's mode, and the old output when the write fails", async () => {
			await write("kept.txt", "Old\n");
			chmodSync(join(files, "kept.txt"), 0o640);
			expect(await copy("hello.txt", "kept.txt")).toEqual(
				Result.succeed({ bytesCopied: 6 }),
			);
			expect(
				(await Bun.file(join(files, "kept.txt")).stat()).mode & 0o777,
			).toBe(0o640);
			await write("kept.txt", "Old\n");
			chmodSync(files, 0o555);
			try {
				expect(await copy("hello.txt", "kept.txt")).toEqual(
					Result.fail(
						new CustomCat.IoFailed({
							message: "Permission denied",
						}),
					),
				);
			} finally {
				chmodSync(files, 0o755);
			}
			expect(await read("kept.txt")).toBe("Old\n");
		});
	});

	describe("CustomWc", () => {
		test("counts lines, words and bytes, as wc does", async () => {
			expect(await count("text.txt")).toEqual(
				Result.succeed({ lines: 3, words: 6, bytes: 33 }),
			);
			expect(await count("empty.txt")).toEqual(
				Result.succeed({ lines: 0, words: 0, bytes: 0 }),
			);
		});

		test("takes a name with the rules a copy's have, and the file must be there", async () => {
			expect(issuesOf(await count("x.md"))).toEqual([
				[tooShort(4), "file"],
			]);
			expect(issuesOf(await count("missing.txt"))).toEqual([
				["No such file or directory", "file"],
			]);
		});

		test("fails with IoFailed for a directory named x.txt", async () => {
			expect(await count("folder.txt")).toEqual(
				Result.fail(
					new CustomWc.IoFailed({ message: "Is a directory" }),
				),
			);
		});
	});
});
