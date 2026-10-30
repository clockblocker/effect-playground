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

// One reader per endpoint of a group, each read by file name. The errors are
// the endpoint's own (from the contract) plus the client's transport errors,
// all inferred, so nothing here restates them.
type Readers<Group> = {
	readonly [Reader in keyof Group]: {
		readonly read: (
			name: string,
		) => Group[Reader] extends (...args: never) => infer Out
			? Plain<Out>
			: never;
	};
};

// The REST client as files.bun.read(name) and files.cpp.read(name). A reader
// added to the contract fails RestFiles.of below until it is wired up.
export class RestFiles extends Context.Service<
	RestFiles,
	Readers<HttpApiClient.ForApi<typeof FilesApi>["files"]>
>()("effect-playground/RestFiles") {
	static readonly layer = Layer.effect(
		RestFiles,
		Effect.map(
			HttpApiClient.make(FilesApi, { baseUrl: origin }),
			(client) =>
				RestFiles.of({
					bun: {
						read: (name) => client.files.bun({ params: { name } }),
					},
					cpp: {
						read: (name) => client.files.cpp({ params: { name } }),
					},
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
