import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { CliFailed } from "./cli-failed.ts";
import { CustomCat, ReadFile } from "./generated/protocol.ts";

// Every call is a POST to /rpc carrying { tag, payload }, such as
// { tag: "ReadFile", payload: { name } }.
export class BffRpcs extends RpcGroup.make(
	Rpc.make("ReadFile", {
		payload: ReadFile.Request,
		success: ReadFile.Success,
		error: ReadFile.Failure,
	}),
	Rpc.make("CustomCat", {
		payload: CustomCat.Request,
		success: CustomCat.Success,
		error: Schema.Union([CustomCat.Failure, CliFailed]),
	}),
) {}
