import { Context, type Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { RpcClient, type RpcClientError, RpcSerialization } from "effect/rpc";
import { BffApi } from "../shared/rest-api.ts";
import { BffRpcs } from "../shared/rpc.ts";

// Vite proxies /api and /rpc to the BFF, so both clients talk to the
// page's own origin.
const origin = window.location.origin;

// Re-states an Effect by its three parts, so it prints as Effect<…> rather
// than as the alias HttpApiClient computes it through (MethodReturn<…>).
type Plain<T> =
	T extends Effect.Effect<infer A, infer E, infer R>
		? Effect.Effect<A, E, R>
		: never;

// The generated client, with each method's result re-stated as a plain Effect.
type PlainClient<Client> = {
	readonly [Group in keyof Client]: {
		readonly [Endpoint in keyof Client[Group]]: Client[Group][Endpoint] extends (
			request: infer Request,
		) => infer Out
			? (request: Request) => Plain<Out>
			: never;
	};
};

// The client HttpApi derives from the REST contract, unchanged; only its type
// is re-stated: client.bff.read({ params: { name } }), client.backend.read(…).
export class BffClient extends Context.Service<
	BffClient,
	PlainClient<HttpApiClient.ForApi<typeof BffApi>>
>()("effect-playground/BffClient") {
	static readonly layer = Layer.effect(
		BffClient,
		HttpApiClient.make(BffApi, { baseUrl: origin }),
	);
}

// A client derived from the RPC contract: client.ReadFileBff({ name }) and
// client.ReadFileBackend({ name }).
export class BffRpcClient extends Context.Service<
	BffRpcClient,
	RpcClient.FromGroup<typeof BffRpcs, RpcClientError.RpcClientError>
>()("effect-playground/BffRpcClient") {
	static readonly layer = Layer.effect(
		BffRpcClient,
		RpcClient.make(BffRpcs),
	).pipe(
		Layer.provide(RpcClient.layerProtocolHttp({ url: `${origin}/rpc` })),
		Layer.provide(RpcSerialization.layerJson),
	);
}

// Builds both clients once and keeps them for the page's lifetime.
export const runtime = ManagedRuntime.make(
	Layer.mergeAll(BffClient.layer, BffRpcClient.layer).pipe(
		Layer.provide(FetchHttpClient.layer),
	),
);
