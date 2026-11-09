import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { ReadFileBff } from "../src/server/bun-side/read-file/read-file.ts";
import { SearchFileBff } from "../src/server/bun-side/search-file/search-file.ts";
import type { Core } from "../src/server/cpp-side/core.ts";
import { RpcRoutes } from "../src/server/protocols/rpc.ts";
import { startCore } from "./support/core.ts";

const directory = mkdtempSync(join(tmpdir(), "rpc-"));

/** The RPC server over `directory`, calling `core`. */
const server = (core: Layer.Layer<Core>) =>
	HttpRouter.toWebHandler(
		RpcRoutes.pipe(
			Layer.provide([SearchFileBff.layer, core]),
			Layer.provideMerge(ReadFileBff.layerIn(directory)),
			Layer.provide(BunServices.layer),
			Layer.provide(BunHttpServer.layerHttpServices),
		),
		{ disableLogger: true },
	);

let core: Awaited<ReturnType<typeof startCore>>;
let rpc: ReturnType<typeof server>;

/** POSTs one raw RPC request, the way the page's client does. */
const call = (tag: string, payload: unknown) =>
	rpc.handler(
		new Request("http://127.0.0.1/rpc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				_tag: "Request",
				id: "1",
				tag,
				payload,
				headers: [],
			}),
		}),
	);

describe.skipIf(Bun.which("cmake") === null)("RPC", () => {
	beforeAll(async () => {
		await Bun.write(join(directory, "files/hello.txt"), "Hello\n");
		core = await startCore(directory);
		rpc = server(core.layer);
	}, 600_000);
	afterAll(async () => {
		await rpc.dispose();
		await core.stop();
		rmSync(directory, { recursive: true, force: true });
	});

	test("answers a payload of the wrong shape with a defect, before the handler", async () => {
		const response = await call("ReadFile", { name: 42 });
		expect(await response.json()).toEqual([
			{
				_tag: "Exit",
				requestId: "1",
				exit: {
					_tag: "Failure",
					cause: [
						{
							_tag: "Die",
							defect: 'Expected string\n  at ["name"]',
						},
					],
				},
			},
		]);
	});

	test("answers a rule a payload breaks with the method's InvalidRequest", async () => {
		const response = await call("ReadFile", { name: "config.json" });
		expect(await response.json()).toEqual([
			{
				_tag: "Exit",
				requestId: "1",
				exit: {
					_tag: "Failure",
					cause: [
						{
							_tag: "Fail",
							error: {
								_tag: "InvalidRequest",
								issues: [
									{
										message:
											"Expected a string matching the RegExp ^.+\\.txt$",
										path: ["name"],
									},
								],
							},
						},
					],
				},
			},
		]);
	});

	test.skipIf(Bun.which("cmake") === null)(
		"leaves a copy's rules to custom_cat, its issues as it words them",
		async () => {
			const response = await call("CustomCat", {
				inputFile: "x.md",
				outputFile: "hello.txt",
			});
			const [{ exit }] = await response.json();
			expect(exit.cause).toEqual([
				{
					_tag: "Fail",
					error: {
						_tag: "InvalidRequest",
						issues: [
							{
								message:
									"Code point count validation failed: Value expected to be greater than or equal to 5, but got 4.",
								path: ["inputFile"],
							},
						],
					},
				},
			]);
		},
		600_000,
	);

	test.skipIf(Bun.which("cmake") === null)(
		"counts with custom_wc, and answers with its success",
		async () => {
			await Bun.write(
				join(directory, "files/two.txt"),
				"one two\nthree\n",
			);
			const response = await call("CustomWc", { file: "two.txt" });
			const [{ exit }] = await response.json();
			expect(exit).toEqual({
				_tag: "Success",
				value: { lines: 2, words: 3, bytes: 14 },
			});
		},
		600_000,
	);

	test("searches a file, and answers with its matches", async () => {
		await Bun.write(join(directory, "files/notes.txt"), "a\nb\na b\n");
		const response = await call("SearchFile", {
			name: "notes.txt",
			query: "b",
		});
		const [{ exit }] = await response.json();
		expect(exit).toEqual({
			_tag: "Success",
			value: {
				matches: [
					{ line: 2, text: "b" },
					{ line: 3, text: "a b" },
				],
			},
		});
	});
});
