import { Context, Effect, Layer, ManagedRuntime } from "effect";
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

// Each reader group's read endpoint, taking just the file name. The errors
// are the endpoint's own (from the contract) plus the client's transport
// errors, all inferred, so nothing here restates them.
type Readers<Client> = {
	readonly [Reader in keyof Client]: {
		readonly read: (name: string) => Client[Reader] extends {
			readonly read: (...args: never) => infer Out;
		}
			? Plain<Out>
			: never;
	};
};

// The REST client as client.bff.read(name) and client.backend.read(name). A
// reader added to the contract fails BffClient.of below until it is wired up.
export class BffClient extends Context.Service<
	BffClient,
	Readers<HttpApiClient.ForApi<typeof BffApi>>
>()("effect-playground/BffClient") {
	static readonly layer = Layer.effect(
		BffClient,
		Effect.map(HttpApiClient.make(BffApi, { baseUrl: origin }), (client) =>
			BffClient.of({
				bff: { read: (name) => client.bff.read({ params: { name } }) },
				backend: {
					read: (name) => client.backend.read({ params: { name } }),
				},
			}),
		),
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
