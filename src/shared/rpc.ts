import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { BackendUnavailable } from "./backend-unavailable.ts";
import { ReadFile } from "./generated/backend-protocol.ts";

// One procedure per reader, no URL design: every call is a POST to /rpc
// carrying { tag: "ReadFileBff" | "ReadFileBackend", payload: { name } }. Only
// the backend one can fail with BackendUnavailable.
export class BffRpcs extends RpcGroup.make(
	Rpc.make("ReadFileBff", {
		payload: ReadFile.Request,
		success: ReadFile.Success,
		error: ReadFile.Failure,
	}),
	Rpc.make("ReadFileBackend", {
		payload: ReadFile.Request,
		success: ReadFile.Success,
		error: Schema.Union([ReadFile.Failure, BackendUnavailable]),
	}),
) {}
