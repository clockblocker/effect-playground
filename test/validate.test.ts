import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCpp, validateFixtureBinary } from "../scripts/cpp.ts";
import { IssueMessage } from "../src/shared/generated/protocol.ts";

const directory = mkdtempSync(join(tmpdir(), "validate-"));
const short = IssueMessage.TooShort({ limit: 5 });
const required = IssueMessage.Missing();

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
			[short, "files", 1, "input"],
			[required, "files", 1, "outputFile"],
			[
				IssueMessage.FileNotFound({ value: "missing.txt" }),
				"files",
				2,
				"input",
			],
			[
				IssueMessage.NotTxtFile({ value: "out.json" }),
				"files",
				2,
				"outputFile",
			],
			[IssueMessage.NotTxtFile({ value: "label.md" }), "label"],
		]);
	});

	test("reports a missing field at any depth", () => {
		expect(issues({ files: [{}] })).toEqual([
			[required, "files", 0, "input"],
			[required, "files", 0, "outputFile"],
			[required, "label"],
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
			[IssueMessage.SameAsInput(), "files", 0, "outputFile"],
			[
				IssueMessage.FileNotFound({ value: "missing.txt" }),
				"files",
				1,
				"input",
			],
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
			[IssueMessage.TooLong({ limit: 25 }), "label"],
			[short, "tags", 1],
			[IssueMessage.NotTxtFile({ value: "x.md" }), "tags", 1],
		]);
	});
});
