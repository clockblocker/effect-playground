import { Rpc, RpcGroup } from "effect/rpc";
import { ReadFile } from "./generated/protocol.ts";

// Every call is a POST to /rpc carrying { tag: "ReadFile", payload: { name } }.
export class BffRpcs extends RpcGroup.make(
	Rpc.make("ReadFile", {
		payload: ReadFile.Request,
		success: ReadFile.Success,
		error: ReadFile.Failure,
	}),
) {}
