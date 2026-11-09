import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { buildCpp, customCatBinary, customWcBinary } from "../scripts/cpp.ts";
import { BffReader } from "../src/server/bun-side/bff-reader.ts";
import { CustomCatCli } from "../src/server/cpp-side/custom-cat.ts";
import { CustomWcCli } from "../src/server/cpp-side/custom-wc.ts";
import { RpcRoutes } from "../src/server/protocols/rpc.ts";

const directory = mkdtempSync(join(tmpdir(), "rpc-"));
const sleepy = join(directory, "sleepy");
const pidFile = join(directory, "pid");

/** The RPC server over `directory`, custom_cat being `binary`. */
const server = (binary: string) =>
	HttpRouter.toWebHandler(
		RpcRoutes.pipe(
			Layer.provide([
				BffReader.layerIn(directory),
				CustomCatCli.layerWith({
					directory,
					binary,
					timeout: "1 minute",
				}),
				CustomWcCli.layerWith({ directory, binary: customWcBinary }),
			]),
			Layer.provide(BunServices.layer),
			Layer.provide(BunHttpServer.layerHttpServices),
		),
		{ disableLogger: true },
	);

// custom_cat is a script that writes its pid and sleeps.
const sleeping = server(sleepy);
const real = server(customCatBinary);

/** POSTs one raw RPC request, the way the page's client does. */
const call = (
	tag: string,
	payload: unknown,
	signal?: AbortSignal,
	handler = sleeping.handler,
) =>
	handler(
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
			signal,
		}),
	);

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("RPC", () => {
	beforeAll(async () => {
		await Bun.write(sleepy, `#!/bin/sh\necho $$ > ${pidFile}\nsleep 30\n`);
		chmodSync(sleepy, 0o755);
	});
	afterAll(async () => {
		await sleeping.dispose();
		await real.dispose();
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
			buildCpp();
			const response = await call(
				"CustomCat",
				{ inputFile: "x.md", outputFile: "hello.txt" },
				undefined,
				real.handler,
			);
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
			buildCpp();
			await Bun.write(
				join(directory, "files/two.txt"),
				"one two\nthree\n",
			);
			const response = await call(
				"CustomWc",
				{ file: "two.txt" },
				undefined,
				real.handler,
			);
			const [{ exit }] = await response.json();
			expect(exit).toEqual({
				_tag: "Success",
				value: { lines: 2, words: 3, bytes: 14 },
			});
		},
		600_000,
	);

	test("kills custom_cat when the client abandons the call", async () => {
		const controller = new AbortController();
		const pending = call(
			"CustomCat",
			{ inputFile: "hello.txt", outputFile: "copy.txt" },
			controller.signal,
		);
		let pid = 0;
		for (let tries = 0; tries < 500 && pid === 0; tries++) {
			await Bun.sleep(10);
			const file = Bun.file(pidFile);
			if (await file.exists()) pid = Number((await file.text()).trim());
		}
		expect(pid).toBeGreaterThan(0);
		expect(alive(pid)).toBe(true);
		controller.abort();
		for (let tries = 0; tries < 100 && alive(pid); tries++)
			await Bun.sleep(10);
		expect(alive(pid)).toBe(false);
		await pending.catch(() => undefined);
	});
});
