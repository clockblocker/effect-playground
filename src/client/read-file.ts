import { Effect, Match } from "effect";
import type { ReadFile } from "../shared/generated/backend-protocol.ts";
import type { Reader } from "../shared/reader.ts";
import { BffRpcClient } from "./clients.ts";

// One call per reader. Each succeeds with the file's contents and fails with
// exactly what it can fail with, so only the backend call lists
// BackendUnavailable: hover one to see it.

// RPC answers with the success struct; the page shows its contents.
const contents = (success: ReadFile.Success) => success.contents;

export const readers = {
	bff: (name: string) =>
		BffRpcClient.use((client) =>
			Effect.map(client.ReadFileBff({ name }), contents),
		),
	backend: (name: string) =>
		BffRpcClient.use((client) =>
			Effect.map(client.ReadFileBackend({ name }), contents),
		),
};

/** Whatever either call can fail with. */
export type ReadFailure = Effect.Error<ReturnType<(typeof readers)[Reader]>>;

/**
 * What the page says when a call fails. The domain errors say it themselves;
 * the transport error is the client's own, so its wording lives here.
 */
export const describeFailure = Match.type<ReadFailure>().pipe(
	Match.tag("RpcClientError", (error) => `Request failed: ${error.message}`),
	Match.orElse((error) => error.message),
);
