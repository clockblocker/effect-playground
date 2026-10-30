import { BunSocket } from "@effect/platform-bun";
import { Config, Context, Effect, Layer, Option } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { BackendUnavailable } from "../shared/backend-unavailable.ts";
import {
	BackendProtocol,
	type ReadFile,
} from "../shared/generated/backend-protocol.ts";

const unavailable = (detail: string) => new BackendUnavailable({ detail });

// The backend, called over JSON-RPC on the TCP port it passes the BFF in
// EFFECT_PLAYGROUND_BACKEND_PORT when it launches it. A transport failure
// becomes BackendUnavailable, so the caller sees a typed error, not a defect.
export class BackendReader extends Context.Service<
	BackendReader,
	{
		readonly read: (
			name: string,
		) => Effect.Effect<
			ReadFile.Success,
			ReadFile.Failure | BackendUnavailable
		>;
	}
>()("effect-playground/BackendReader") {
	static readonly layer = Layer.unwrap(
		Effect.gen(function* () {
			const port = yield* Config.option(
				Config.Port("EFFECT_PLAYGROUND_BACKEND_PORT"),
			);
			if (Option.isNone(port)) {
				const missing = unavailable(
					"the BFF runs without the backend, which launches it (bun run dev starts both)",
				);
				return Layer.succeed(BackendReader, {
					read: () => Effect.fail(missing),
				});
			}
			return BackendReader.connect(port.value);
		}),
	);

	static connect(port: number) {
		const address = `127.0.0.1:${port}`;
		return Layer.effect(
			BackendReader,
			Effect.gen(function* () {
				const client = yield* RpcClient.make(BackendProtocol);
				// A generator body, not an arrow: Effect.fn gives an arrow body the
				// expected return type Effect<A, any, any>, and catchTag then infers
				// its error type from that `any`.
				const read = Effect.fn("BackendReader.read")(function* (
					name: string,
				) {
					return yield* client.ReadFile({ name }).pipe(
						Effect.timeoutOrElse({
							duration: "5 seconds",
							orElse: () =>
								Effect.fail(
									unavailable(
										`${address} did not answer in 5 s`,
									),
								),
						}),
						Effect.catchTag("RpcClientError", (error) =>
							Effect.fail(
								unavailable(
									`cannot reach ${address} (${error.message})`,
								),
							),
						),
					);
				});
				return BackendReader.of({ read });
			}),
		).pipe(
			Layer.provide(RpcClient.layerProtocolSocket()),
			Layer.provide(BunSocket.layerNet({ host: "127.0.0.1", port })),
			Layer.provide(RpcSerialization.layerNdJsonRpc()),
		);
	}
}
