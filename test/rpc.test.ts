import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { BffReader } from "../src/server/bff-reader.ts";
import { CustomCatCli } from "../src/server/custom-cat.ts";
import { RpcRoutes } from "../src/server/rpc.ts";

const directory = mkdtempSync(join(tmpdir(), "rpc-"));
const sleepy = join(directory, "sleepy");
const pidFile = join(directory, "pid");

// custom_cat is a script that writes its pid and sleeps.
const { handler, dispose } = HttpRouter.toWebHandler(
	RpcRoutes.pipe(
		Layer.provide([
			BffReader.layerIn(directory),
			CustomCatCli.layerWith({
				directory,
				binary: sleepy,
				timeout: "1 minute",
			}),
		]),
		Layer.provide(BunServices.layer),
		Layer.provide(BunHttpServer.layerHttpServices),
	),
	{ disableLogger: true },
);

/** POSTs one raw RPC request, the way the page's client does. */
const call = (tag: string, payload: unknown, signal?: AbortSignal) =>
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
		await dispose();
		rmSync(directory, { recursive: true, force: true });
	});

	test("answers a payload that doesn't decode with a defect, before the handler", async () => {
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
