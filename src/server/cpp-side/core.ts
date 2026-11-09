import { BunSocket } from "@effect/platform-bun";
import { Config, Context, Duration, Effect, Layer, Option } from "effect";
import { RpcClient, RpcClientError, RpcSerialization } from "effect/rpc";
import { CoreRpcs } from "../../shared/generated/generated.ts";
import { CoreUnavailable } from "../../shared/helpers/tagged-errors.ts";

/** The core's operations, as RpcClient makes them: CustomCat, CustomWc, … */
type Operations = RpcClient.FromGroup<
	typeof CoreRpcs,
	RpcClientError.RpcClientError
>;

interface Options {
	/** How long a call may take before it fails as CoreUnavailable. */
	readonly timeout?: Duration.Input;
}

/**
 * The C++ core, which launches the BFF and serves the C++ operations over
 * JSON-RPC on the port it passes in EFFECT_PLAYGROUND_CORE_PORT. A call
 * that can't reach it, or that it doesn't answer in time, fails as
 * CoreUnavailable, so the caller sees a typed error, not a defect.
 */
export class Core extends Context.Service<
	Core,
	{
		/** Calls one of the core's operations, such as `(core) => core.CustomCat(request)`. */
		readonly call: <A, E>(
			operation: (operations: Operations) => Effect.Effect<A, E>,
		) => Effect.Effect<
			A,
			Exclude<E, RpcClientError.RpcClientError> | CoreUnavailable
		>;
	}
>()("effect-playground/Core") {
	/** The core that launched this BFF, or none, so that every call fails. */
	static readonly layer = Layer.unwrap(
		Effect.gen(function* () {
			const port = yield* Config.option(
				Config.Port("EFFECT_PLAYGROUND_CORE_PORT"),
			);
			if (Option.isNone(port)) {
				const missing = new CoreUnavailable({
					message:
						"The BFF runs without the core, which launches it: bun run dev starts both",
				});
				return Layer.succeed(
					Core,
					Core.of({ call: () => Effect.fail(missing) }),
				);
			}
			return Core.connect(port.value);
		}),
	);

	/** The core on 127.0.0.1:`port`. */
	static connect(
		port: number,
		{ timeout = Duration.seconds(5) }: Options = {},
	) {
		const address = `127.0.0.1:${port}`;
		const millis = Duration.toMillis(timeout);
		return Layer.effect(
			Core,
			Effect.gen(function* () {
				const operations = yield* RpcClient.make(CoreRpcs);
				const call = <A, E>(
					operation: (operations: Operations) => Effect.Effect<A, E>,
				) =>
					operation(operations).pipe(
						Effect.timeoutOrElse({
							duration: timeout,
							orElse: () =>
								Effect.fail(
									new CoreUnavailable({
										message: `The core at ${address} didn't answer in ${millis} ms`,
									}),
								),
						}),
						Effect.mapError((error) =>
							error instanceof RpcClientError.RpcClientError
								? new CoreUnavailable({
										message: `The core at ${address} can't be reached: ${error.message}`,
									})
								: (error as Exclude<
										E,
										RpcClientError.RpcClientError
									>),
						),
					);
				return Core.of({ call });
			}),
		).pipe(
			Layer.provide(RpcClient.layerProtocolSocket()),
			Layer.provide(BunSocket.layerNet({ host: "127.0.0.1", port })),
			Layer.provide(RpcSerialization.layerNdJsonRpc()),
			// The socket opens per call, which fails as CoreUnavailable: making
			// the layer can't fail.
			Layer.orDie,
		);
	}
}
