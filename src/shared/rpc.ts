import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { ReaderUnavailable, ReadFileError } from "./errors.ts";
import {
	ReadFileRequest,
	ReadFileSuccess,
} from "./generated/reader-protocol.ts";
import { Reader } from "./reader.ts";

// One procedure, no URL design: every call is a POST to /rpc carrying
// { tag: "ReadFile", payload: { name, reader } }.
export class FilesRpcs extends RpcGroup.make(
	Rpc.make("ReadFile", {
		payload: { ...ReadFileRequest.fields, reader: Reader },
		success: ReadFileSuccess,
		error: Schema.Union([ReadFileError, ReaderUnavailable]),
	}),
) {}
