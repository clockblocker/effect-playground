import { afterEach, beforeAll, describe, expect, test } from "bun:test";
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
import { Schema } from "effect";
import { buildCpp, customCatBinary } from "../scripts/cpp.ts";
import { CustomCat, IoFailed } from "../src/shared/generated/protocol.ts";

// What the BFF decodes custom_cat's stdout with.
const success = Schema.decodeUnknownSync(
	Schema.fromJsonString(CustomCat.Success),
);
const invalidRequest = Schema.decodeUnknownSync(
	Schema.fromJsonString(CustomCat.InvalidRequest),
);
const ioFailed = Schema.decodeUnknownSync(Schema.fromJsonString(IoFailed));

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
	afterEach(() => {
		chmodSync(join(directory, "files"), 0o755);
		rmSync(directory, { recursive: true, force: true });
	});

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
					message: '"config.json" is not a .txt file',
					path: ["inputFile"],
				},
				{
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
				'{"_tag":"InvalidRequest","issues":[{' +
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
		expect(invalidRequest(result.stdout).issues).toEqual([
			{
				message: "Must be at least 5 characters long",
				path: ["inputFile"],
			},
			{
				message: "Must be at least 5 characters long",
				path: ["outputFile"],
			},
		]);
	});

	test("reports a missing flag as Missing, on its field", async () => {
		const result = await customCat(["--input-file=hello.txt"]);
		expect(result.exitCode).toBe(1);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{ message: "Required", path: ["outputFile"] },
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

	test("reports a missing x.txt as an issue, but a directory named x.txt as IoFailed", async () => {
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
			stdout: '{"_tag":"IoFailed","operation":"read","file":"dir.txt","reason":"Is a directory"}\n',
			stderr: "",
			exitCode: 3,
		});
		expect(ioFailed(again.stdout)).toBeInstanceOf(IoFailed);
	});

	test("refuses to copy a file onto itself", async () => {
		const result = await customCat([
			"--input-file=hello.txt",
			"--output-file=hello.txt",
		]);
		expect(result.exitCode).toBe(1);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{
				message: "Must not be the input file",
				path: ["outputFile"],
			},
		]);
	});

	test("refuses a hard link to the input as the output", async () => {
		await customCat(["--input-file=hello.txt"]);
		linkSync(
			join(directory, "files/hello.txt"),
			join(directory, "files/same.txt"),
		);
		const result = await run([
			"--input-file=hello.txt",
			"--output-file=same.txt",
		]);
		expect(result.exitCode).toBe(1);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{
				message: '"same.txt" is the input file under another name',
				path: ["outputFile"],
			},
		]);
	});

	test("checks the names' own rules before comparing them", async () => {
		const result = await customCat([
			"--input-file=missing.txt",
			"--output-file=missing.txt",
		]);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{ message: '"missing.txt" does not exist', path: ["inputFile"] },
		]);
	});

	test("takes a plain name, not a path", async () => {
		const result = await customCat([
			"--input-file=../files/hello.txt",
			"--output-file=../x.txt",
		]);
		expect(result.exitCode).toBe(1);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{ message: "Must be a file name, not a path", path: ["inputFile"] },
			{
				message: "Must be a file name, not a path",
				path: ["outputFile"],
			},
		]);
		expect(await Bun.file(join(directory, "x.txt")).exists()).toBe(false);
	});

	test("refuses a link in files/, wherever it leads", async () => {
		await customCat(["--input-file=hello.txt"], {
			"hello.txt": "Hello\n",
			"secret.txt": "Secret\n",
		});
		const outside = join(directory, "outside.txt");
		await Bun.write(outside, "Outside\n");
		symlinkSync(outside, join(directory, "files/out.txt"));
		symlinkSync("secret.txt", join(directory, "files/in.txt"));
		const result = await run([
			"--input-file=out.txt",
			"--output-file=in.txt",
		]);
		expect(result.exitCode).toBe(1);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{
				message:
					'"out.txt" is a link, which could lead outside the files directory',
				path: ["inputFile"],
			},
			{
				message:
					'"in.txt" is a link, which could lead outside the files directory',
				path: ["outputFile"],
			},
		]);
		expect(await Bun.file(outside).text()).toBe("Outside\n");
	});

	test("keeps the old output when the write fails", async () => {
		const result = await customCat(
			["--input-file=hello.txt", "--output-file=copy.txt"],
			{ "hello.txt": "Hello\n", "copy.txt": "Old\n" },
		);
		expect(result.exitCode).toBe(0);
		await Bun.write(file("copy.txt"), "Old\n");
		chmodSync(join(directory, "files"), 0o555);
		const failed = await run([
			"--input-file=hello.txt",
			"--output-file=copy.txt",
		]);
		expect(failed.exitCode).toBe(3);
		expect(ioFailed(failed.stdout)).toEqual(
			new IoFailed({
				operation: "write",
				file: "copy.txt",
				reason: "Permission denied",
			}),
		);
		expect(await file("copy.txt").text()).toBe("Old\n");
	});

	test("leaves no temporary file behind when the rename fails", async () => {
		await customCat(["--input-file=hello.txt"]);
		mkdirSync(join(directory, "files/out.txt/inside"), { recursive: true });
		const failed = await run([
			"--input-file=hello.txt",
			"--output-file=out.txt",
		]);
		expect(failed.exitCode).toBe(3);
		expect(ioFailed(failed.stdout)).toEqual(
			new IoFailed({
				operation: "write",
				file: "out.txt",
				reason: "Is a directory",
			}),
		);
		expect(readdirSync(join(directory, "files")).sort()).toEqual([
			"hello.txt",
			"out.txt",
		]);
		expect(readdirSync(join(directory, "files/out.txt"))).toEqual([
			"inside",
		]);
	});

	test("keeps an overwritten output's mode", async () => {
		await customCat(["--input-file=hello.txt"], {
			"hello.txt": "Hello\n",
			"copy.txt": "Old\n",
		});
		chmodSync(join(directory, "files/copy.txt"), 0o640);
		const result = await run([
			"--input-file=hello.txt",
			"--output-file=copy.txt",
		]);
		expect(result.exitCode).toBe(0);
		expect((await file("copy.txt").stat()).mode & 0o777).toBe(0o640);
	});
});
