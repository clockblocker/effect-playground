import { Match } from "effect";
import type { Atom } from "effect/reactivity";
import { BffRpcClient } from "./clients.ts";

export const readFile = BffRpcClient.mutation("ReadFile");

export type ReadFailure = Atom.Failure<typeof readFile>;

/**
 * What the page says when a call fails. The domain errors say it themselves;
 * the transport error is the client's own, so its wording lives here.
 */
export const describeFailure = Match.type<ReadFailure>().pipe(
	Match.tag("RpcClientError", (error) => `Request failed: ${error.message}`),
	Match.orElse((error) => error.message),
);
