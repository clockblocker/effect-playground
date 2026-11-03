import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { buildCpp, customCatBinary } from "../scripts/cpp.ts";
import {
	CustomCat,
	FileNotFound,
	NotTxtFile,
} from "../src/shared/generated/protocol.ts";

// What the BFF decodes custom_cat's stdout with.
const success = Schema.decodeUnknownSync(
	Schema.fromJsonString(CustomCat.Success),
);
const failure = Schema.decodeUnknownSync(
	Schema.fromJsonString(CustomCat.Failure),
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

	test("fails with NotTxtFile for an input that isn't .txt", async () => {
		const result = await customCat(
			["--input-file=config.json", "--output-file=copy.txt"],
			{ "config.json": "{}" },
		);
		expect(result).toEqual({
			stdout: '{"_tag":"NotTxtFile","file":"config.json"}\n',
			stderr: 'custom_cat: "config.json" is not a .txt file\n',
			exitCode: 1,
		});
	});

	test("fails with NotTxtFile for an output that isn't .txt", async () => {
		const result = await customCat([
			"--input-file=hello.txt",
			"--output-file=copy.json",
		]);
		expect(result.exitCode).toBe(1);
		expect(failure(result.stdout)).toEqual(
			new NotTxtFile({ file: "copy.json" }),
		);
		expect(await file("copy.json").exists()).toBe(false);
	});

	test("fails with FileNotFound for a missing input", async () => {
		const result = await customCat([
			"--input-file=missing.txt",
			"--output-file=copy.txt",
		]);
		expect(result).toEqual({
			stdout: '{"_tag":"FileNotFound","file":"missing.txt"}\n',
			stderr: 'custom_cat: "missing.txt" does not exist\n',
			exitCode: 1,
		});
		expect(failure(result.stdout)).toBeInstanceOf(FileNotFound);
	});

	test("rejects a 4-character name as a bad argument", async () => {
		const result = await customCat([
			"--input-file=x.md",
			"--output-file=copy.txt",
		]);
		expect(result).toEqual({
			stdout: "",
			stderr:
				"custom_cat: Failed to parse field 'input-file': Size validation " +
				"failed: Value expected to be greater than or equal to 5, but got 4.\n",
			exitCode: 2,
		});
	});

	test("rejects a missing flag as a bad argument", async () => {
		const result = await customCat(["--input-file=hello.txt"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe(
			"custom_cat: Field named 'output-file' not found.\n",
		);
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
