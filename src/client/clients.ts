import { Context, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, type RpcClientError, RpcSerialization } from "effect/rpc";
import { BffRpcs } from "../shared/rpc.ts";

// The page talks to the BFF over RPC only; the BFF's REST API is for other
// clients. Vite proxies /rpc to the BFF, so the page uses its own origin.
const origin = window.location.origin;

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

// Builds the client once and keeps it for the page's lifetime.
export const runtime = ManagedRuntime.make(
	BffRpcClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
);
