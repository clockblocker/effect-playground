import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCpp, validateFixtureBinary } from "../scripts/cpp.ts";

const directory = mkdtempSync(join(tmpdir(), "validate-"));

/** The [code, ...path] of each issue the C++ walker finds in `batch`. */
function issues(batch: object): unknown[] {
	const result = Bun.spawnSync(
		[validateFixtureBinary, JSON.stringify(batch)],
		{ cwd: directory },
	);
	expect(result.exitCode).toBe(0);
	return JSON.parse(result.stdout.toString()).map(
		({ code, path }: { code: string; path: unknown[] }) => [code, ...path],
	);
}

describe.skipIf(Bun.which("cmake") === null)("validate", () => {
	beforeAll(async () => {
		buildCpp();
		await Bun.write(join(directory, "files/hello.txt"), "Hello\n");
	}, 600_000);
	afterAll(() => rmSync(directory, { recursive: true, force: true }));

	test("finds nothing wrong with a valid request", () => {
		expect(
			issues({
				files: [{ input: "hello.txt", outputFile: "copy.txt" }],
				label: "label.txt",
			}),
		).toEqual([]);
	});

	test("puts each issue under its wire path, indexes as numbers", () => {
		expect(
			issues({
				files: [
					{ input: "hello.txt", outputFile: "copy.txt" },
					{ input: "x.md" },
					{ input: "missing.txt", outputFile: "out.json" },
				],
				label: "label.md",
			}),
		).toEqual([
			["TooShort", "files", 1, "input"],
			["Missing", "files", 1, "outputFile"],
			["FileNotFound", "files", 2, "input"],
			["NotTxtFile", "files", 2, "outputFile"],
			["NotTxtFile", "label"],
		]);
	});

	test("reports a missing field at any depth", () => {
		expect(issues({ files: [{}] })).toEqual([
			["Missing", "files", 0, "input"],
			["Missing", "files", 0, "outputFile"],
			["Missing", "label"],
		]);
	});

	test("runs a struct's rules once its fields pass theirs", () => {
		expect(
			issues({
				files: [
					{ input: "hello.txt", outputFile: "hello.txt" },
					{ input: "missing.txt", outputFile: "missing.txt" },
				],
				label: "label.txt",
			}),
		).toEqual([
			["SameAsInput", "files", 0, "outputFile"],
			["FileNotFound", "files", 1, "input"],
		]);
	});

	test("reports every failed rule of one level, and only that level", () => {
		expect(
			issues({
				files: [],
				label: "a".repeat(30),
				tags: ["notes.txt", "x.md"],
			}),
		).toEqual([
			["TooLong", "label"],
			["TooShort", "tags", 1],
			["NotTxtFile", "tags", 1],
		]);
	});
});
