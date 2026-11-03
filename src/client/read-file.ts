import { Match } from "effect";
import type { Atom } from "effect/reactivity";
import type { Reader } from "../shared/reader.ts";
import { BffRpcClient } from "./clients.ts";

// One mutation per reader. Each succeeds with the success struct and fails
// with exactly what its procedure can fail with, so only the backend one
// lists BackendUnavailable: hover one to see it.
export const reads = {
	bff: BffRpcClient.mutation("ReadFileBff"),
	backend: BffRpcClient.mutation("ReadFileBackend"),
};

/** Whatever either mutation can fail with. */
export type ReadFailure = Atom.Failure<(typeof reads)[Reader]>;

/**
 * What the page says when a call fails. The domain errors say it themselves;
 * the transport error is the client's own, so its wording lives here.
 */
export const describeFailure = Match.type<ReadFailure>().pipe(
	Match.tag("RpcClientError", (error) => `Request failed: ${error.message}`),
	Match.orElse((error) => error.message),
);
