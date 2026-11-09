import type { RpcClientError } from "effect/rpc";
import { BffRpcClient } from "./clients/bff-rpc-client.ts";

/**
 * An operation's failure on the page: as the BFF answers it, such as a
 * CppSideFailure, or the transport's. A mutation's is inferred, as
 * Atom.Failure<typeof dataService.mutation.customCat>; this names it.
 */
export type PageFailure<F> = F | RpcClientError.RpcClientError;

/** The page's one way to the BFF: an atom per procedure, by kind. */
export const dataService = {
	mutation: {
		readFile: BffRpcClient.mutation("ReadFile"),
		searchFile: BffRpcClient.mutation("SearchFile"),
		customCat: BffRpcClient.mutation("CustomCat"),
		customWc: BffRpcClient.mutation("CustomWc"),
	},
} as const;
