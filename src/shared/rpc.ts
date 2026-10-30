import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { ReadFile } from "./generated/reader-protocol.ts";
import { ReaderUnavailable } from "./reader-unavailable.ts";

// One procedure per reader, no URL design: every call is a POST to /rpc
// carrying { tag: "ReadFileBun" | "ReadFileCpp", payload: { name } }. Only the
// C++ one can fail with ReaderUnavailable.
export class FilesRpcs extends RpcGroup.make(
	Rpc.make("ReadFileBun", {
		payload: ReadFile.Request,
		success: ReadFile.Success,
		error: ReadFile.Error,
	}),
	Rpc.make("ReadFileCpp", {
		payload: ReadFile.Request,
		success: ReadFile.Success,
		error: Schema.Union([ReadFile.Error, ReaderUnavailable]),
	}),
) {}
