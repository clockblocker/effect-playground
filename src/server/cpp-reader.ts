import { BunSocket } from "@effect/platform-bun";
import { Config, Context, Effect, Layer, Option } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { ReaderUnavailable, type ReadFileError } from "../shared/errors.ts";
import {
	ReaderProtocol,
	type ReadFileSuccess,
} from "../shared/generated/reader-protocol.ts";

const unavailable = (detail: string) => new ReaderUnavailable({ detail });

// The C++ reader, called over JSON-RPC on the TCP port the launcher passes in
// EFFECT_PLAYGROUND_CPP_PORT. A transport failure becomes ReaderUnavailable,
// so the caller sees a typed error, not a defect.
export class CppReader extends Context.Service<
	CppReader,
	{
		readonly read: (
			name: string,
		) => Effect.Effect<ReadFileSuccess, ReadFileError | ReaderUnavailable>;
	}
>()("effect-playground/CppReader") {
	static readonly layer = Layer.unwrap(
		Effect.gen(function* () {
			const port = yield* Config.option(
				Config.Port("EFFECT_PLAYGROUND_CPP_PORT"),
			);
			if (Option.isNone(port)) {
				const missing = unavailable(
					"the server runs without the C++ launcher (bun run dev starts both)",
				);
				return Layer.succeed(CppReader, {
					read: () => Effect.fail(missing),
				});
			}
			return CppReader.connect(port.value);
		}),
	);

	static connect(port: number) {
		const address = `127.0.0.1:${port}`;
		return Layer.effect(
			CppReader,
			Effect.gen(function* () {
				const client = yield* RpcClient.make(ReaderProtocol);
				const read = Effect.fn("CppReader.read")((name: string) =>
					client.ReadFile({ name }).pipe(
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
					),
				);
				return CppReader.of({ read });
			}),
		).pipe(
			Layer.provide(RpcClient.layerProtocolSocket()),
			Layer.provide(BunSocket.layerNet({ host: "127.0.0.1", port })),
			Layer.provide(RpcSerialization.layerNdJsonRpc()),
		);
	}
}
