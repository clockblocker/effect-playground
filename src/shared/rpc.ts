import { Rpc, RpcGroup } from "effect/rpc";
import {
	CustomCat,
	CustomWc,
	ReadFile,
	SearchFile,
} from "./generated/generated.ts";
import { cppSideFailure } from "./helpers/tagged-errors.ts";

// Every call is a POST to /rpc carrying { tag, payload }, such as
// { tag: "ReadFile", payload: { name } }. A payload is decoded by its shape
// alone, so a rule it breaks comes back as the method's InvalidRequest.
export class BffRpcs extends RpcGroup.make(
	Rpc.make("ReadFile", {
		payload: ReadFile.RequestShape,
		success: ReadFile.Success,
		error: ReadFile.Failure,
	}),
	Rpc.make("SearchFile", {
		payload: SearchFile.RequestShape,
		success: SearchFile.Success,
		error: SearchFile.Failure,
	}),
	Rpc.make("CustomCat", {
		payload: CustomCat.RequestShape,
		success: CustomCat.Success,
		error: cppSideFailure(CustomCat.Failure),
	}),
	Rpc.make("CustomWc", {
		payload: CustomWc.RequestShape,
		success: CustomWc.Success,
		error: cppSideFailure(CustomWc.Failure),
	}),
) {}
