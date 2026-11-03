import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { buildCpp, customCatBinary } from "../scripts/cpp.ts";
import { CustomCat } from "../src/shared/generated/protocol.ts";

// What the BFF decodes custom_cat's stdout with.
const success = Schema.decodeUnknownSync(
	Schema.fromJsonString(CustomCat.Success),
);
const invalidRequest = Schema.decodeUnknownSync(
	Schema.fromJsonString(CustomCat.InvalidRequest),
);

let directory = "";

/** Runs custom_cat in a fresh directory whose files/ holds `files`. */
async function customCat(
	args: readonly string[],
	files: Record<string, string> = { "hello.txt": "Hello\n" },
) {
	directory = mkdtempSync(join(tmpdir(), "custom-cat-"));
	for (const [name, text] of Object.entries(files)) {
		await Bun.write(join(directory, "files", name), text);
	}
	return run(args);
}

async function run(args: readonly string[]) {
	const child = Bun.spawn([customCatBinary, ...args], {
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

const file = (name: string) => Bun.file(join(directory, "files", name));

describe.skipIf(Bun.which("cmake") === null)("custom_cat", () => {
	beforeAll(buildCpp, 600_000);
	afterEach(() => rmSync(directory, { recursive: true, force: true }));

	test("copies the input to the output", async () => {
		const result = await customCat([
			"--input-file=hello.txt",
			"--output-file=copy.txt",
		]);
		expect(result).toEqual({
			stdout: '{"bytesCopied":6}\n',
			stderr: "",
			exitCode: 0,
		});
		expect(await file("copy.txt").text()).toBe("Hello\n");
	});

	test("overwrites an output that exists", async () => {
		const result = await customCat(
			["--input-file=hello.txt", "--output-file=copy.txt"],
			{ "hello.txt": "Hello\n", "copy.txt": "something much longer\n" },
		);
		expect(result.exitCode).toBe(0);
		expect(success(result.stdout)).toEqual({ bytesCopied: 6 });
		expect(await file("copy.txt").text()).toBe("Hello\n");
	});

	test("reports every field that isn't .txt, each under its path", async () => {
		const result = await customCat(
			["--input-file=config.json", "--output-file=x.json"],
			{ "config.json": "{}" },
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			_tag: "InvalidRequest",
			issues: [
				{
					code: "NotTxtFile",
					message: '"config.json" is not a .txt file',
					path: ["inputFile"],
				},
				{
					code: "NotTxtFile",
					message: '"x.json" is not a .txt file',
					path: ["outputFile"],
				},
			],
		});
		expect(invalidRequest(result.stdout)).toBeInstanceOf(
			CustomCat.InvalidRequest,
		);
		expect(await file("x.json").exists()).toBe(false);
	});

	test("reports a missing input as FileNotFound", async () => {
		const result = await customCat([
			"--input-file=missing.txt",
			"--output-file=copy.txt",
		]);
		expect(result).toEqual({
			stdout:
				'{"_tag":"InvalidRequest","issues":[{"code":"FileNotFound",' +
				'"message":"\\"missing.txt\\" does not exist","path":["inputFile"]}]}\n',
			stderr: "",
			exitCode: 1,
		});
		expect(await file("copy.txt").exists()).toBe(false);
	});

	test("checks a name's bounds before anything else about it", async () => {
		const result = await customCat([
			"--input-file=x.md",
			"--output-file=copy.txt",
		]);
		expect(result.exitCode).toBe(1);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{
				code: "TooShort",
				message: "Must be at least 5 characters long",
				path: ["inputFile"],
			},
		]);
	});

	test("reports a name too long", async () => {
		const result = await customCat([
			"--input-file=hello.txt",
			`--output-file=${"a".repeat(23)}.txt`,
		]);
		expect(result.exitCode).toBe(1);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{
				code: "TooLong",
				message: "Must be at most 25 characters long",
				path: ["outputFile"],
			},
		]);
	});

	test("reports both names too short", async () => {
		const result = await customCat([
			"--input-file=x.md",
			"--output-file=y.md",
		]);
		expect(result.exitCode).toBe(1);
		expect(
			invalidRequest(result.stdout).issues.map(({ code, path }) => [
				code,
				...path,
			]),
		).toEqual([
			["TooShort", "inputFile"],
			["TooShort", "outputFile"],
		]);
	});

	test("reports a missing flag as Missing, on its field", async () => {
		const result = await customCat(["--input-file=hello.txt"]);
		expect(result.exitCode).toBe(1);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{ code: "Missing", message: "Required", path: ["outputFile"] },
		]);
	});

	test("rejects an unknown flag as a usage error", async () => {
		const result = await customCat([
			"--input-file=hello.txt",
			"--output-file=copy.txt",
			"--verbose",
		]);
		expect(result.stdout).toBe("");
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toStartWith(
			"custom_cat: Value named 'verbose' not used.",
		);
	});

	test("reports a missing x.txt, but a directory named x.txt is a defect", async () => {
		const result = await customCat([
			"--input-file=dir.txt",
			"--output-file=copy.txt",
		]);
		mkdirSync(join(directory, "files/dir.txt"));
		const again = await run([
			"--input-file=dir.txt",
			"--output-file=copy.txt",
		]);
		expect(result.exitCode).toBe(1);
		expect(again).toEqual({
			stdout: "",
			stderr: "custom_cat: cannot read files/dir.txt\n",
			exitCode: 3,
		});
	});

	test("keeps both files in files/, by base name", async () => {
		const result = await customCat([
			"--input-file=../files/hello.txt",
			"--output-file=../copy.txt",
		]);
		expect(result.exitCode).toBe(0);
		expect(await file("copy.txt").text()).toBe("Hello\n");
		expect(await Bun.file(join(directory, "copy.txt")).exists()).toBe(
			false,
		);
	});
});
