import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { buildCpp, customWcBinary } from "../scripts/cpp.ts";
import { CustomWc } from "../src/shared/generated/generated.ts";

// What the BFF decodes custom_wc's stdout with.
const output = Schema.decodeUnknownSync(Schema.fromJsonString(CustomWc.Output));

let directory = "";

/** Runs custom_wc in a fresh directory whose files/ holds `files`. */
async function customWc(
	args: readonly string[],
	files: Record<string, string> = { "hello.txt": "Hello\n" },
) {
	directory = mkdtempSync(join(tmpdir(), "custom-wc-"));
	for (const [name, text] of Object.entries(files)) {
		await Bun.write(join(directory, "files", name), text);
	}
	const child = Bun.spawn([customWcBinary, ...args], {
		cwd: directory,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe.skipIf(Bun.which("cmake") === null)("custom_wc", () => {
	beforeAll(buildCpp, 600_000);
	afterEach(() => rmSync(directory, { recursive: true, force: true }));

	test("counts lines, words and bytes, as wc does", async () => {
		const result = await customWc(["--file=text.txt"], {
			"text.txt": "one two\n  three\t four\n\nno newline",
		});
		expect(result).toEqual({
			stdout: '{"_tag":"Success","lines":3,"words":6,"bytes":33}\n',
			stderr: "",
			exitCode: 0,
		});
		expect(output(result.stdout)).toEqual({
			_tag: "Success",
			lines: 3,
			words: 6,
			bytes: 33,
		});
	});

	test("counts an empty file as nothing", async () => {
		const result = await customWc(["--file=empty.txt"], {
			"empty.txt": "",
		});
		expect(output(result.stdout)).toEqual({
			_tag: "Success",
			lines: 0,
			words: 0,
			bytes: 0,
		});
	});

	test("takes a name with the rules custom_cat's input has", async () => {
		const result = await customWc(["--file=x.md"]);
		expect(result.exitCode).toBe(1);
		expect(output(result.stdout)).toEqual(
			new CustomWc.InvalidRequest({
				issues: [
					{
						message:
							"Code point count validation failed: Value expected to be greater than or equal to 5, but got 4.",
						path: ["file"],
					},
				],
			}),
		);
	});

	test("reports a missing file as an issue, in the system's words", async () => {
		const result = await customWc(["--file=missing.txt"]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout)).toEqual({
			_tag: "InvalidRequest",
			issues: [{ message: "No such file or directory", path: ["file"] }],
		});
	});

	test("reports a missing flag as an issue on its field", async () => {
		const result = await customWc([]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).issues).toEqual([
			{ message: "Field named 'file' not found.", path: ["file"] },
		]);
	});

	test("fails with IoFailed for a directory named x.txt", async () => {
		const result = await customWc(["--file=hello.txt"]);
		mkdirSync(join(directory, "files/dir.txt"));
		const child = Bun.spawnSync([customWcBinary, "--file=dir.txt"], {
			cwd: directory,
		});
		expect(result.exitCode).toBe(0);
		expect(child.exitCode).toBe(3);
		expect(output(child.stdout.toString())).toEqual(
			new CustomWc.IoFailed({ message: "Is a directory" }),
		);
	});
});
