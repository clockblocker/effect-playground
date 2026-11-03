import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { buildCpp } from "../scripts/cpp.ts";
import { CustomCatCli } from "../src/server/custom-cat.ts";
import { McpRoutes } from "../src/server/mcp.ts";

const directory = mkdtempSync(join(tmpdir(), "mcp-"));

const { handler, dispose } = HttpRouter.toWebHandler(
	McpRoutes.pipe(
		Layer.provide(CustomCatCli.layerIn(directory)),
		Layer.provide(BunServices.layer),
	),
	{ disableLogger: true },
);

let session = "";
let nextId = 1;

/** Sends one JSON-RPC message to /mcp, the way an MCP client over HTTP does. */
async function post(method: string, params?: object) {
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
}

const callCustomCat = async (inputFile: string, outputFile: string) =>
	(
		await post("tools/call", {
			name: "custom_cat",
			arguments: { inputFile, outputFile },
		})
	).body.result;

describe.skipIf(Bun.which("cmake") === null)("MCP server", () => {
	beforeAll(async () => {
		buildCpp();
		await Bun.write(join(directory, "files/hello.txt"), "Hello\n");
	}, 600_000);
	afterAll(async () => {
		await dispose();
		rmSync(directory, { recursive: true, force: true });
	});

	test("initializes a session", async () => {
		const initialized = await post("initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "test", version: "1" },
		});
		expect(initialized.status).toBe(200);
		expect(initialized.body.result).toMatchObject({
			protocolVersion: "2025-11-25",
			serverInfo: { name: "effect-playground" },
			capabilities: { tools: {} },
		});
		session = initialized.session ?? "";
		expect(session).not.toBe("");
		expect((await post("notifications/initialized")).status).toBe(202);
	});

	test("lists custom_cat with the generated request's fields", async () => {
		const { body } = await post("tools/list");
		expect(body.result.tools).toEqual([
			expect.objectContaining({
				name: "custom_cat",
				inputSchema: expect.objectContaining({
					type: "object",
					properties: {
						inputFile: {
							type: "string",
							minLength: 5,
							maxLength: 25,
						},
						outputFile: {
							type: "string",
							minLength: 5,
							maxLength: 25,
						},
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

	test("answers an InvalidRequest with a tool error, a line per issue", async () => {
		expect(await callCustomCat("config.json", "x.json")).toEqual({
			content: [
				{
					type: "text",
					text:
						'inputFile: "config.json" is not a .txt file\n' +
						'outputFile: "x.json" is not a .txt file',
				},
			],
			isError: true,
		});
		expect(await callCustomCat("missing.txt", "copy.txt")).toEqual({
			content: [
				{
					type: "text",
					text: 'inputFile: "missing.txt" does not exist',
				},
			],
			isError: true,
		});
	});
});
