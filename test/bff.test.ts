import { afterAll, describe, expect, test } from "bun:test";
import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { Effect, Layer, Result } from "effect";
import { HttpRouter } from "effect/http";
import { BffReader } from "../src/server/bff-reader.ts";
import { RestRoutes } from "../src/server/rest.ts";
import { ReadFile } from "../src/shared/generated/protocol.ts";

// Both read the repository's files/.
const read = (name: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* BffReader).read(name);
		}).pipe(
			Effect.result,
			Effect.provide(
				BffReader.layer.pipe(Layer.provide(BunServices.layer)),
			),
		),
	);

const { handler, dispose } = HttpRouter.toWebHandler(
	RestRoutes.pipe(
		Layer.provide(BffReader.layer),
		Layer.provide(BunHttpServer.layerHttpServices),
	),
	{ disableLogger: true },
);

const get = async (name: string) => {
	const response = await handler(
		new Request(`http://127.0.0.1/api/files/read/${name}`),
	);
	return { status: response.status, body: await response.text() };
};

afterAll(dispose);

describe("BffReader", () => {
	test("reads a .txt file", async () => {
		const result = await read("hello.txt");
		expect(Result.isSuccess(result) && result.success.contents).toStartWith(
			"Hello",
		);
	});

	test("fails with an InvalidRequest whose issue is on name", async () => {
		expect(await read("config.json")).toEqual(
			Result.fail(
				new ReadFile.InvalidRequest({
					issues: [
						{
							code: "NotTxtFile",
							message: '"config.json" is not a .txt file',
							path: ["name"],
						},
					],
				}),
			),
		);
		const missing = await read("missing.txt");
		expect(Result.isFailure(missing) && missing.failure.issues).toEqual([
			{
				code: "FileNotFound",
				message: '"missing.txt" does not exist',
				path: ["name"],
			},
		]);
	});
});

describe("REST read", () => {
	test("answers a file with its text", async () => {
		const { status, body } = await get("hello.txt");
		expect(status).toBe(200);
		expect(body).toStartWith("Hello");
	});

	test("answers an InvalidRequest with 422 and its issues", async () => {
		const { status, body } = await get("config.json");
		expect(status).toBe(422);
		expect(JSON.parse(body)).toEqual({
			_tag: "InvalidRequest",
			issues: [
				{
					code: "NotTxtFile",
					message: '"config.json" is not a .txt file',
					path: ["name"],
				},
			],
		});
		expect((await get("missing.txt")).status).toBe(422);
	});

	test("still rejects a name out of bounds before the handler, with 400", async () => {
		expect((await get("x.md")).status).toBe(400);
	});
});
