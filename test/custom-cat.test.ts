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
const output = Schema.decodeUnknownSync(
	Schema.fromJsonString(CustomCat.Output),
);
const invalidRequest = (stdout: string) => {
	const decoded = output(stdout);
	expect(decoded).toBeInstanceOf(CustomCat.InvalidRequest);
	return decoded as CustomCat.InvalidRequest;
};

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

// reflect-cpp's own messages, as each validator words them.
const notTxt = (name: string) =>
	`String '${name}' did not match format '.txt file name': '^.+\\.txt$'.`;
const notPlain = (name: string) =>
	`String '${name}' did not match format 'plain file name': '^(?!\\.\\.?$)[^/\\\\]*$'.`;
const tooShort = (size: number) =>
	`Code point count validation failed: Value expected to be greater than or equal to 5, but got ${size}.`;

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
			stdout: '{"_tag":"Success","bytesCopied":6}\n',
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
		expect(output(result.stdout)).toEqual({
			_tag: "Success",
			bytesCopied: 6,
		});
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
				{ message: notTxt("config.json"), path: ["inputFile"] },
				{ message: notTxt("x.json"), path: ["outputFile"] },
			],
		});
		expect(invalidRequest(result.stdout)).toBeInstanceOf(
			CustomCat.InvalidRequest,
		);
		expect(await file("x.json").exists()).toBe(false);
	});

	test("reports a missing input in the system's words", async () => {
		const result = await customCat([
			"--input-file=missing.txt",
			"--output-file=copy.txt",
		]);
		expect(result).toEqual({
			stdout:
				'{"_tag":"InvalidRequest","issues":[{' +
				'"message":"No such file or directory","path":["inputFile"]}]}\n',
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
			{ message: tooShort(4), path: ["inputFile"] },
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
				message:
					"Code point count validation failed: Value expected to be less than or equal to 25, but got 27.",
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
			{ message: tooShort(4), path: ["inputFile"] },
			{ message: tooShort(4), path: ["outputFile"] },
		]);
	});

	test("rejects a missing flag as a usage error, in reflect-cpp's words", async () => {
		const result = await customCat(["--input-file=hello.txt"]);
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("Field named 'output-file' not found.");
	});

	test("counts a name's code points, not its bytes, as the form does", async () => {
		const formAccepts = Schema.is(CustomCat.Request);
		const cases = [
			// 20 code points, 36 bytes.
			[`${"ä".repeat(16)}.txt`, undefined],
			["äö.t", tooShort(4)],
			[
				`${"ä".repeat(22)}.txt`,
				"Code point count validation failed: Value expected to be less than or equal to 25, but got 26.",
			],
		] as const;
		await customCat(["--input-file=hello.txt"]);
		for (const [name, message] of cases) {
			const result = await run([
				"--input-file=hello.txt",
				`--output-file=${name}`,
			]);
			expect(result.exitCode).toBe(message === undefined ? 0 : 1);
			if (message !== undefined) {
				expect(invalidRequest(result.stdout).issues).toEqual([
					{ message, path: ["outputFile"] },
				]);
			}
			expect(
				formAccepts({ inputFile: "hello.txt", outputFile: name }),
			).toBe(message === undefined);
		}
		expect(Buffer.byteLength(cases[0][0])).toBe(36);
	});

	test("rejects a name that isn't valid UTF-8", async () => {
		await customCat(["--input-file=hello.txt"]);
		const child = Bun.spawn(
			[
				"sh",
				"-c",
				`exec "$0" --input-file=hello.txt --output-file="$(printf 'ab\\377cd.txt')"`,
				customCatBinary,
			],
			{ cwd: directory, stdout: "pipe" },
		);
		const stdout = await new Response(child.stdout).text();
		expect(await child.exited).toBe(1);
		expect(invalidRequest(stdout).issues).toEqual([
			{ message: "String is not valid UTF-8.", path: ["outputFile"] },
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
			stdout: '{"_tag":"IoFailed","message":"Is a directory"}\n',
			stderr: "",
			exitCode: 3,
		});
		expect(output(again.stdout)).toBeInstanceOf(IoFailed);
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
			{ message: "No such file or directory", path: ["inputFile"] },
		]);
	});

	test("takes a plain name, not a path", async () => {
		const result = await customCat([
			"--input-file=../files/hello.txt",
			"--output-file=../x.txt",
		]);
		expect(result.exitCode).toBe(1);
		expect(invalidRequest(result.stdout).issues).toEqual([
			{ message: notPlain("../files/hello.txt"), path: ["inputFile"] },
			{ message: notPlain("../x.txt"), path: ["outputFile"] },
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
		expect(output(failed.stdout)).toEqual(
			new IoFailed({ message: "Permission denied" }),
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
		expect(output(failed.stdout)).toEqual(
			new IoFailed({ message: "Is a directory" }),
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
