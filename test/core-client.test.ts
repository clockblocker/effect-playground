import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer, Result } from "effect";
import { Core } from "../src/server/cpp-side/core.ts";
import { CoreUnavailable } from "../src/shared/helpers/tagged-errors.ts";
import { closedPort, fakeCore, runWith } from "./support/core.ts";

// Core when there's no core to answer, or it answers wrong. The real one's
// answers are core.test.ts's.

const count = Effect.gen(function* () {
	return yield* (yield* Core).call((operations) =>
		operations.CustomWc({ file: "hello.txt" }),
	);
});

describe("Core", () => {
	test("fails every call as CoreUnavailable when the BFF runs without the core", async () => {
		const layer = Core.layer.pipe(
			Layer.provide(Layer.empty),
		) as Layer.Layer<Core>;
		const previous = Bun.env.EFFECT_PLAYGROUND_CORE_PORT;
		delete Bun.env.EFFECT_PLAYGROUND_CORE_PORT;
		try {
			expect(await runWith(layer, count)).toEqual(
				Result.fail(
					new CoreUnavailable({
						message:
							"The BFF runs without the core, which launches it: bun run dev starts both",
					}),
				),
			);
		} finally {
			if (previous !== undefined)
				Bun.env.EFFECT_PLAYGROUND_CORE_PORT = previous;
		}
	});

	test("fails as CoreUnavailable when nothing listens on the core's port", async () => {
		const port = closedPort();
		const result = await runWith(Core.connect(port), count);
		expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
			CoreUnavailable,
		);
		expect(Result.isFailure(result) && result.failure.message).toStartWith(
			`The core at 127.0.0.1:${port} can't be reached: `,
		);
	});

	test("fails as CoreUnavailable when the core doesn't answer in time", async () => {
		const silent = fakeCore(() => undefined);
		try {
			expect(
				await runWith(
					Core.connect(silent.port, { timeout: "200 millis" }),
					count,
				),
			).toEqual(
				Result.fail(
					new CoreUnavailable({
						message: `The core at 127.0.0.1:${silent.port} didn't answer in 200 ms`,
					}),
				),
			);
		} finally {
			silent.stop();
		}
	});

	test("dies with the core's defect, which no caller can act on", async () => {
		const broken = fakeCore(({ id }) => ({
			jsonrpc: "2.0",
			id,
			error: {
				_tag: "Cause",
				code: 0,
				message: "secret",
				data: [
					{
						_tag: "Die",
						defect: { name: "Error", message: "secret" },
					},
				],
			},
		}));
		try {
			const exit = await Effect.runPromiseExit(
				count.pipe(Effect.provide(Core.connect(broken.port))),
			);
			expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(
				true,
			);
			expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(
				false,
			);
		} finally {
			broken.stop();
		}
	});
});
