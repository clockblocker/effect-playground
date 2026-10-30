import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { ReaderUnavailable, ReadFileError } from "./errors.ts";
import {
	ReadFileRequest,
	ReadFileSuccess,
} from "./generated/reader-protocol.ts";

// One procedure per reader, no URL design: every call is a POST to /rpc
// carrying { tag: "ReadFileBun" | "ReadFileCpp", payload: { name } }. Only the
// C++ one can fail with ReaderUnavailable.
export class FilesRpcs extends RpcGroup.make(
	Rpc.make("ReadFileBun", {
		payload: ReadFileRequest,
		success: ReadFileSuccess,
		error: ReadFileError,
	}),
	Rpc.make("ReadFileCpp", {
		payload: ReadFileRequest,
		success: ReadFileSuccess,
		error: Schema.Union([ReadFileError, ReaderUnavailable]),
	}),
) {}
