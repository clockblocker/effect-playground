import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCpp, validateFixtureBinary } from "../scripts/cpp.ts";

const directory = mkdtempSync(join(tmpdir(), "validate-"));
// reflect-cpp's own messages, as each validator words them.
const short =
	"Code point count validation failed: Value expected to be greater than or equal to 5, but got 4.";
const notTxt = (name: string) =>
	`String '${name}' did not match format '.txt file name': '^.+\\.txt$'.`;

/** The [message, ...path] of each issue the C++ walker finds in `batch`. */
function issues(batch: object): unknown[] {
	const result = Bun.spawnSync(
		[validateFixtureBinary, JSON.stringify(batch)],
		{ cwd: directory },
	);
	expect(result.exitCode).toBe(0);
	return JSON.parse(result.stdout.toString()).map(
		({ message, path }: { message: string; path: unknown[] }) => [
			message,
			...path,
		],
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
				tags: [],
			}),
		).toEqual([]);
	});

	test("puts each issue under its wire path, indexes as numbers", () => {
		expect(
			issues({
				files: [
					{ input: "hello.txt", outputFile: "copy.txt" },
					{ input: "x.md", outputFile: "copy.txt" },
					{ input: "missing.txt", outputFile: "out.json" },
				],
				label: "label.md",
				tags: [],
			}),
		).toEqual([
			[short, "files", 1, "input"],
			["No such file or directory", "files", 2, "input"],
			[notTxt("out.json"), "files", 2, "outputFile"],
			[notTxt("label.md"), "label"],
		]);
	});

	test("leaves a missing field to reflect-cpp's read, at any depth", () => {
		const result = Bun.spawnSync(
			[validateFixtureBinary, JSON.stringify({ files: [{}] })],
			{ cwd: directory },
		);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.toString()).toContain(
			"Field named 'input' not found.",
		);
	});

	test("runs a struct's rules once its fields pass theirs", () => {
		expect(
			issues({
				files: [
					{ input: "hello.txt", outputFile: "hello.txt" },
					{ input: "missing.txt", outputFile: "missing.txt" },
				],
				label: "label.txt",
				tags: [],
			}),
		).toEqual([
			["Must not be the input file", "files", 0, "outputFile"],
			["No such file or directory", "files", 1, "input"],
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
			[
				"Code point count validation failed: Value expected to be less than or equal to 25, but got 30.",
				"label",
			],
			[short, "tags", 1],
			[notTxt("x.md"), "tags", 1],
		]);
	});
});
