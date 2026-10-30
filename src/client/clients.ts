import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { RpcClient, type RpcClientError, RpcSerialization } from "effect/rpc";
import { FilesApi } from "../shared/rest-api.ts";
import { FilesRpcs } from "../shared/rpc.ts";

// Vite proxies /api and /rpc to the Bun server, so both clients talk to the
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

// The REST client as files.bun.read(name) and files.cpp.read(name). A reader
// added to the contract fails RestFiles.of below until it is wired up.
export class RestFiles extends Context.Service<
	RestFiles,
	Readers<HttpApiClient.ForApi<typeof FilesApi>>
>()("effect-playground/RestFiles") {
	static readonly layer = Layer.effect(
		RestFiles,
		Effect.map(HttpApiClient.make(FilesApi, { baseUrl: origin }), (files) =>
			RestFiles.of({
				bun: { read: (name) => files.bun.read({ params: { name } }) },
				cpp: { read: (name) => files.cpp.read({ params: { name } }) },
			}),
		),
	);
}

// A client derived from the RPC contract: client.ReadFileBun({ name }) and
// client.ReadFileCpp({ name }).
export class RpcFilesClient extends Context.Service<
	RpcFilesClient,
	RpcClient.FromGroup<typeof FilesRpcs, RpcClientError.RpcClientError>
>()("effect-playground/RpcFilesClient") {
	static readonly layer = Layer.effect(
		RpcFilesClient,
		RpcClient.make(FilesRpcs),
	).pipe(
		Layer.provide(RpcClient.layerProtocolHttp({ url: `${origin}/rpc` })),
		Layer.provide(RpcSerialization.layerJson),
	);
}

// Builds both clients once and keeps them for the page's lifetime.
export const runtime = ManagedRuntime.make(
	Layer.mergeAll(RestFiles.layer, RpcFilesClient.layer).pipe(
		Layer.provide(FetchHttpClient.layer),
	),
);
