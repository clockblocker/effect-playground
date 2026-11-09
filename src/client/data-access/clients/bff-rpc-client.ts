import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { AtomRpc } from "effect/reactivity";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { BffRpcs } from "../../../shared/rpc.ts";

const origin = window.location.origin;

const httpClient = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		return HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
	}),
).pipe(Layer.provide(FetchHttpClient.layer));

export class BffRpcClient extends AtomRpc.Service<BffRpcClient>()(
	"effect-playground/BffRpcClient",
	{
		group: BffRpcs,
		protocol: RpcClient.layerProtocolHttp({ url: `${origin}/rpc` }).pipe(
			Layer.provide(RpcSerialization.layerJson),
			Layer.provide(httpClient),
		),
	},
) {}
