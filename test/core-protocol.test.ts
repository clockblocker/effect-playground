import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCore } from "./support/core.ts";

// The core's side of Effect's JSON-RPC dialect, frame by frame, and what the
// typed client never sends: a missing or unknown field, or bytes that
// aren't UTF-8.

const directory = mkdtempSync(join(tmpdir(), "core-protocol-"));
let core: Awaited<ReturnType<typeof startCore>>;

/** Sends `frames`, each a line, and returns the first `count` lines back. */
function exchange(frames: ReadonlyArray<string | Uint8Array>, count: number) {
	return new Promise<string[]>((resolve) => {
		const lines: string[] = [];
		let buffer = "";
		Bun.connect({
			hostname: "127.0.0.1",
			port: core.port,
			socket: {
				open(socket) {
					for (const frame of frames) {
						socket.write(frame);
						socket.write("\n");
					}
				},
				data(socket, data) {
					buffer += new TextDecoder().decode(data);
					const parts = buffer.split("\n");
					buffer = parts.pop() ?? "";
					lines.push(...parts);
					if (lines.length >= count) {
						socket.end();
						resolve(lines.slice(0, count));
					}
				},
			},
		});
	});
}

const request = (id: unknown, method: string, params: object) =>
	JSON.stringify({ jsonrpc: "2.0", id, method, params });

const failure = (id: unknown, error: object, message: string) => ({
	jsonrpc: "2.0",
	id,
	error: {
		_tag: "Cause",
		code: 0,
		message,
		data: [{ _tag: "Fail", error }],
	},
});

describe.skipIf(Bun.which("cmake") === null)("the core's JSON-RPC", () => {
	beforeAll(async () => {
		await Bun.write(join(directory, "files/hello.txt"), "Hello\n");
		core = await startCore(directory);
	}, 600_000);
	afterAll(async () => {
		await core.stop();
		rmSync(directory, { recursive: true, force: true });
	});

	test("answers Effect's dialect, a line per frame, its id unchanged", async () => {
		const lines = await exchange(
			[
				request(0, "CustomWc", { file: "hello.txt" }),
				request("1", "CustomCat", {
					inputFile: "hello.txt",
					outputFile: "hello.txt",
				}),
				request(2, "Nope", {}),
				// Interrupt needs no answer; the Ping after it gets the next line.
				JSON.stringify({
					jsonrpc: "2.0",
					method: "@effect/rpc/Interrupt",
					params: { requestId: 1 },
				}),
				JSON.stringify({ jsonrpc: "2.0", method: "@effect/rpc/Ping" }),
			],
			4,
		);
		expect(lines.map((line) => JSON.parse(line))).toEqual([
			{ jsonrpc: "2.0", id: 0, result: { lines: 1, words: 1, bytes: 6 } },
			failure(
				"1",
				{
					_tag: "InvalidRequest",
					issues: [
						{
							message: "Must not be the input file",
							path: ["outputFile"],
						},
					],
				},
				"Must not be the input file",
			),
			{
				jsonrpc: "2.0",
				id: 2,
				error: {
					_tag: "Cause",
					code: 0,
					message: "Unknown method: Nope",
					data: [
						{
							_tag: "Die",
							defect: {
								name: "Error",
								message: "Unknown method: Nope",
							},
						},
					],
				},
			},
			{ jsonrpc: "2.0", method: "@effect/rpc/Pong" },
		]);
	});

	test("reports a missing field and an unknown one as issues, in reflect-cpp's words", async () => {
		const [line] = await exchange(
			[
				request(3, "CustomCat", {
					inputFile: "hello.txt",
					verbose: true,
				}),
			],
			1,
		);
		expect(JSON.parse(line ?? "").error.data[0].error).toEqual({
			_tag: "InvalidRequest",
			issues: [
				{
					message: "Value named 'verbose' not used.",
					path: ["verbose"],
				},
				{
					message: "Field named 'outputFile' not found.",
					path: ["outputFile"],
				},
			],
		});
	});

	test("answers a frame that isn't JSON, such as bytes that aren't UTF-8, with a defect of the connection", async () => {
		const [notJson, notUtf8] = await exchange(
			[
				"not json",
				// 0xFF is never a byte of UTF-8.
				Buffer.concat([
					Buffer.from(
						'{"jsonrpc":"2.0","id":4,"method":"CustomWc","params":{"file":"ab',
					),
					Buffer.from([0xff]),
					Buffer.from('cd.txt"}}'),
				]),
			],
			2,
		);
		for (const line of [notJson, notUtf8]) {
			expect(JSON.parse(line ?? "")).toMatchObject({
				id: -32603,
				error: { _tag: "Defect", code: 1 },
			});
		}
	});
});
