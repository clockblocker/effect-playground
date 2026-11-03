import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { buildCpp } from "../scripts/cpp.ts";
import { CustomCatCli } from "../src/server/cpp-side/custom-cat.ts";
import { McpRoutes } from "../src/server/protocols/mcp.ts";

const directory = mkdtempSync(join(tmpdir(), "mcp-"));

const disposers: Array<() => Promise<void>> = [];

/** An MCP client over HTTP, of a server whose custom_cat is `binary`. */
function mcp(binary?: string) {
	const { handler, dispose } = HttpRouter.toWebHandler(
		McpRoutes.pipe(
			Layer.provide(CustomCatCli.layerWith({ directory, binary })),
			Layer.provide(BunServices.layer),
		),
		{ disableLogger: true },
	);
	disposers.push(dispose);
	let session = "";
	let nextId = 1;

	/** Sends one JSON-RPC message to /mcp, the way an MCP client over HTTP does. */
	const post = async (method: string, params?: object) => {
		const notification = method.startsWith("notifications/");
		const response = await handler(
			new Request("http://127.0.0.1/mcp", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					...(session === ""
						? {}
						: {
								"mcp-session-id": session,
								"mcp-protocol-version": "2025-11-25",
							}),
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					...(notification ? {} : { id: nextId++ }),
					method,
					...(params === undefined ? {} : { params }),
				}),
			}),
		);
		return {
			status: response.status,
			session: response.headers.get("mcp-session-id"),
			body: notification ? undefined : await response.json(),
		};
	};

	const initialize = async () => {
		const initialized = await post("initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "test", version: "1" },
		});
		session = initialized.session ?? "";
		await post("notifications/initialized");
		return initialized;
	};

	const callCustomCat = async (inputFile: string, outputFile: string) =>
		(
			await post("tools/call", {
				name: "custom_cat",
				arguments: { inputFile, outputFile },
			})
		).body.result;

	return { post, initialize, callCustomCat };
}

const { post, initialize, callCustomCat } = mcp();

/** An MCP client whose server's custom_cat is a script that runs `body`. */
async function withScript(name: string, body: string) {
	const path = join(directory, name);
	await Bun.write(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
	const client = mcp(path);
	await client.initialize();
	return client;
}

describe.skipIf(Bun.which("cmake") === null)("MCP server", () => {
	beforeAll(async () => {
		buildCpp();
		await Bun.write(join(directory, "files/hello.txt"), "Hello\n");
	}, 600_000);
	afterAll(async () => {
		for (const dispose of disposers) await dispose();
		rmSync(directory, { recursive: true, force: true });
	});

	test("initializes a session", async () => {
		const initialized = await initialize();
		expect(initialized.status).toBe(200);
		expect(initialized.body.result).toMatchObject({
			protocolVersion: "2025-11-25",
			serverInfo: { name: "effect-playground" },
			capabilities: { tools: {} },
		});
		expect(initialized.session ?? "").not.toBe("");
	});

	test("lists custom_cat with the request's fields, by shape alone", async () => {
		const { body } = await post("tools/list");
		expect(body.result.tools).toEqual([
			expect.objectContaining({
				name: "custom_cat",
				inputSchema: expect.objectContaining({
					type: "object",
					properties: {
						inputFile: { type: "string" },
						outputFile: { type: "string" },
					},
					required: ["inputFile", "outputFile"],
				}),
			}),
		]);
	});

	test("copies, and answers with the success", async () => {
		expect(await callCustomCat("hello.txt", "copy.txt")).toEqual({
			content: [{ type: "text", text: '{"bytesCopied":6}' }],
			structuredContent: { bytesCopied: 6 },
			isError: false,
		});
		expect(await Bun.file(join(directory, "files/copy.txt")).text()).toBe(
			"Hello\n",
		);
	});

	test("answers custom_cat's InvalidRequest with a tool error, a line per issue", async () => {
		expect(await callCustomCat("config.json", "x.json")).toEqual({
			content: [
				{
					type: "text",
					text:
						"inputFile: String 'config.json' did not match format '.txt file name': '^.+\\.txt$'.\n" +
						"outputFile: String 'x.json' did not match format '.txt file name': '^.+\\.txt$'.",
				},
			],
			isError: true,
		});
		expect(await callCustomCat("missing.txt", "copy.txt")).toEqual({
			content: [
				{ type: "text", text: "inputFile: No such file or directory" },
			],
			isError: true,
		});
	});

	test("answers a parameter that doesn't decode with a tool error, from McpServer", async () => {
		const { body } = await post("tools/call", {
			name: "custom_cat",
			arguments: { inputFile: "hello.txt" },
		});
		expect(body.result).toEqual({
			content: [
				{
					type: "text",
					text: `Invalid parameters for tool 'custom_cat': Missing key\n  at ["outputFile"]`,
				},
			],
			isError: true,
		});
	});

	test("answers a failure of what it depends on with a tool error, its message as text", async () => {
		mkdirSync(join(directory, "files/dir.txt"));
		expect(await callCustomCat("hello.txt", "dir.txt")).toEqual({
			content: [
				{
					type: "text",
					text: `Couldn't write "dir.txt": Is a directory`,
				},
			],
			isError: true,
		});
		const missing = mcp(join(directory, "missing"));
		await missing.initialize();
		expect(await missing.callCustomCat("hello.txt", "copy.txt")).toEqual({
			content: [{ type: "text", text: "custom_cat can't be found" }],
			isError: true,
		});
	});

	test("answers a defect with a tool error that says nothing about it", async () => {
		const broken = await withScript("broken", "echo secret >&2\nexit 4");
		expect(await broken.callCustomCat("hello.txt", "copy.txt")).toEqual({
			content: [
				{
					type: "text",
					text: "Tool execution failed due to an internal server error.",
				},
			],
			isError: true,
		});
	});
});
