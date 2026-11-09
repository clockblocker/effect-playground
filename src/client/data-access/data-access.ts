import type { RpcClientError } from "effect/rpc";
import { BffRpcClient } from "./clients/bff-rpc-client.ts";

/**
 * An operation's failure on the page: as the BFF answers it, such as a
 * CppSideFailure, or the transport's. A mutation's is inferred, as
 * Atom.Failure<typeof customCat>; this names it.
 */
export type PageFailure<F> = F | RpcClientError.RpcClientError;

export const readFile = BffRpcClient.mutation("ReadFile");
export const searchFile = BffRpcClient.mutation("SearchFile");
export const customCat = BffRpcClient.mutation("CustomCat");
export const customWc = BffRpcClient.mutation("CustomWc");
