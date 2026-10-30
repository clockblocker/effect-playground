import { Effect, Match } from "effect";
import type { ReadFile } from "../shared/generated/backend-protocol.ts";
import type { Reader } from "../shared/reader.ts";
import { BffClient, BffRpcClient } from "./clients.ts";

// One call per transport and reader. Each succeeds with the file's contents
// and fails with exactly what it can fail with, so only the backend calls
// list BackendUnavailable: hover one to see it.

export const rest = {
	bff: (name: string) => BffClient.use((client) => client.bff.read(name)),
	backend: (name: string) =>
		BffClient.use((client) => client.backend.read(name)),
};

// RPC answers with the success struct; its contents make it look like REST.
const contents = (success: ReadFile.Success) => success.contents;

export const rpc = {
	bff: (name: string) =>
		BffRpcClient.use((client) =>
			Effect.map(client.ReadFileBff({ name }), contents),
		),
	backend: (name: string) =>
		BffRpcClient.use((client) =>
			Effect.map(client.ReadFileBackend({ name }), contents),
		),
};

/** Whatever any of the calls can fail with. */
export type ReadFailure = Effect.Error<
	ReturnType<(typeof rest | typeof rpc)[Reader]>
>;

/**
 * What the page says when a call fails. The domain errors say it themselves;
 * the transport errors are the client's own, so their wording lives here.
 */
export const describeFailure = Match.type<ReadFailure>().pipe(
	Match.tag(
		"HttpClientError",
		"SchemaError",
		"RpcClientError",
		(error) => `Request failed: ${error.message}`,
	),
	Match.orElse((error) => error.message),
);
