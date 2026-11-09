/*
Generated
- from: cpp/domain/protocol.hpp
- by: scripts/generate.ts
*/

import { Rpc, RpcGroup } from "effect/rpc";
import { CustomCat } from "./custom-cat/custom-cat-namespace.ts";
import { CustomWc } from "./custom-wc/custom-wc-namespace.ts";

/** The C++ core's operations, as the BFF calls them over JSON-RPC: each request by its shape alone, as the core checks its rules. */
export class CoreRpcs extends RpcGroup.make(
	Rpc.make("CustomCat", {
		payload: CustomCat.RequestShape,
		success: CustomCat.Success,
		error: CustomCat.Failure,
	}),
	Rpc.make("CustomWc", {
		payload: CustomWc.RequestShape,
		success: CustomWc.Success,
		error: CustomWc.Failure,
	}),
) {}
