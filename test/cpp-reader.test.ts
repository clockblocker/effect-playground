import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { Effect } from "effect";
import { buildCpp } from "../scripts/cpp.ts";
import { CppReader } from "../src/server/cpp-reader.ts";
import { FileNotFound, NotTxtFile } from "../src/shared/errors.ts";

const files = new URL("../files", import.meta.url).pathname;

let reader: Subprocess<"ignore", "ignore", "pipe"> | undefined;
let port = 0;

const read = (name: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const cpp = yield* CppReader;
			return yield* cpp.read(name);
		}).pipe(Effect.result, Effect.provide(CppReader.connect(port))),
	);

describe.skipIf(Bun.which("cmake") === null)("C++ reader", () => {
	// Builds the C++ project (the first build fetches reflect-cpp) and starts the
	// reader without a child command, so it only serves.
	beforeAll(async () => {
		const binary = buildCpp();
		reader = Bun.spawn([binary, "--files", files], {
			env: { ...process.env, EFFECT_PLAYGROUND_CPP_PORT: "" },
			stdin: "ignore",
			stdout: "ignore",
			stderr: "pipe",
		});
		port = await listeningPort(reader.stderr);
	}, 600_000);

	afterAll(() => reader?.kill("SIGTERM"));

	test("answers Effect's JSON-RPC dialect, one frame per line", async () => {
		const frames = [
			{
				jsonrpc: "2.0",
				id: 0,
				method: "ReadFile",
				params: { name: "hello.txt" },
			},
			{
				jsonrpc: "2.0",
				id: 1,
				method: "ReadFile",
				params: { name: "a.json" },
			},
			{
				jsonrpc: "2.0",
				id: "2",
				method: "ReadFile",
				params: { name: "x.txt" },
			},
			// Interrupt needs no answer; the Ping after it gets the next line.
			{
				jsonrpc: "2.0",
				method: "@effect/rpc/Interrupt",
				params: { requestId: 1 },
			},
			{ jsonrpc: "2.0", method: "@effect/rpc/Ping" },
		];
		const lines = await exchange(frames, 4);
		expect(lines.map((line) => JSON.parse(line))).toEqual([
			{
				jsonrpc: "2.0",
				id: 0,
				result: {
					contents: await Bun.file(`${files}/hello.txt`).text(),
				},
			},
			causeResponse(1, { _tag: "NotTxtFile", name: "a.json" }),
			causeResponse("2", { _tag: "FileNotFound", name: "x.txt" }),
			{ jsonrpc: "2.0", method: "@effect/rpc/Pong" },
		]);
	});

	test("reflect-cpp rejects a name shorter than 5 as a defect", async () => {
		const [line = ""] = await exchange(
			[
				{
					jsonrpc: "2.0",
					id: 3,
					method: "ReadFile",
					params: { name: "x.md" },
				},
			],
			1,
		);
		const message =
			"Invalid ReadFile params: Failed to parse field 'name': Size " +
			"validation failed: Value expected to be greater than or equal to " +
			"5, but got 4.";
		expect(JSON.parse(line)).toEqual({
			jsonrpc: "2.0",
			id: 3,
			error: {
				_tag: "Cause",
				code: 0,
				message,
				data: [{ _tag: "Die", defect: { name: "Error", message } }],
			},
		});
	});

	test("the Effect RPC client reads contents", async () => {
		const result = await read("hello.txt");
		expect(result._tag).toBe("Success");
		if (result._tag === "Success") {
			expect(result.success.contents).toStartWith("Hello");
		}
	});

	test("the Effect RPC client gets NotTxtFile as its class", async () => {
		const result = await read("config.json");
		expect(result._tag === "Failure" && result.failure).toEqual(
			new NotTxtFile({ name: "config.json" }),
		);
		expect(result._tag === "Failure" && result.failure).toBeInstanceOf(
			NotTxtFile,
		);
	});

	test("the Effect RPC client gets FileNotFound as its class", async () => {
		const result = await read("missing.txt");
		expect(result._tag === "Failure" && result.failure).toBeInstanceOf(
			FileNotFound,
		);
	});
});

describe("C++ reader bridge", () => {
	test("sends a request frame the C++ side can answer", async () => {
		// A stand-in for the C++ reader that records what Effect sends.
		const received: unknown[] = [];
		const server = Bun.listen({
			hostname: "127.0.0.1",
			port: 0,
			socket: {
				data(socket, data) {
					for (const line of data
						.toString()
						.split("\n")
						.filter(Boolean)) {
						const frame = JSON.parse(line);
						received.push(frame);
						socket.write(
							`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { contents: "stub" } })}\n`,
						);
					}
				},
			},
		});
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* CppReader).read("hello.txt");
			}).pipe(Effect.provide(CppReader.connect(server.port))),
		);
		server.stop(true);
		expect(result).toEqual({ contents: "stub" });
		expect(received).toEqual([
			expect.objectContaining({
				jsonrpc: "2.0",
				id: expect.anything(),
				method: "ReadFile",
				params: { name: "hello.txt" },
			}),
		]);
	});

	test("an unreachable reader fails with ReaderUnavailable", async () => {
		const closed = Bun.listen({
			hostname: "127.0.0.1",
			port: 0,
			socket: { data() {} },
		});
		const unusedPort = closed.port;
		closed.stop(true);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* CppReader).read("hello.txt");
			}).pipe(Effect.flip, Effect.provide(CppReader.connect(unusedPort))),
		);
		expect(result._tag).toBe("ReaderUnavailable");
	});
});

function causeResponse(id: number | string, error: object) {
	return {
		jsonrpc: "2.0",
		id,
		error: {
			_tag: "Cause",
			code: 0,
			message: (error as { _tag: string })._tag,
			data: [{ _tag: "Fail", error }],
		},
	};
}

/** Sends frames over a raw TCP connection and collects `count` reply lines. */
async function exchange(frames: object[], count: number): Promise<string[]> {
	const { promise, resolve } = Promise.withResolvers<string[]>();
	let buffer = "";
	const socket = await Bun.connect({
		hostname: "127.0.0.1",
		port,
		socket: {
			data(_, data) {
				buffer += data.toString();
				const lines = buffer.split("\n").filter(Boolean);
				if (lines.length >= count) resolve(lines);
			},
		},
	});
	socket.write(frames.map((frame) => `${JSON.stringify(frame)}\n`).join(""));
	const lines = await promise;
	socket.end();
	return lines;
}

async function listeningPort(stderr: ReadableStream<Uint8Array>) {
	const decoder = new TextDecoder();
	let output = "";
	for await (const chunk of stderr) {
		output += decoder.decode(chunk, { stream: true });
		const match = /127\.0\.0\.1:(\d+)/.exec(output);
		if (match?.[1] !== undefined) return Number(match[1]);
	}
	throw new Error(`The C++ reader exited: ${output}`);
}
