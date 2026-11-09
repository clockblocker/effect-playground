import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { CustomCat, ReadFile } from "./generated/generated.ts";
import { CliFailed } from "./helpers/cli-failed.ts";

// Every call is a POST to /rpc carrying { tag, payload }, such as
// { tag: "ReadFile", payload: { name } }. A payload is decoded by its shape
// alone, so a rule it breaks comes back as the method's InvalidRequest.
export class BffRpcs extends RpcGroup.make(
	Rpc.make("ReadFile", {
		payload: ReadFile.RequestShape,
		success: ReadFile.Success,
		error: ReadFile.Failure,
	}),
	Rpc.make("CustomCat", {
		payload: CustomCat.RequestShape,
		success: CustomCat.Success,
		error: Schema.Union([CustomCat.Failure, CliFailed]),
	}),
) {}
