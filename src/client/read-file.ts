import { Effect, Match } from "effect";
import type { ReadFile } from "../shared/generated/reader-protocol.ts";
import type { Reader } from "../shared/reader.ts";
import { RestFiles, RpcFilesClient } from "./clients.ts";

// One call per transport and reader. Each succeeds with the file's contents
// and fails with exactly what it can fail with, so only the C++ calls list
// ReaderUnavailable: hover one to see it.

export const rest = {
	bun: (name: string) => RestFiles.use((files) => files.bun(name)),
	cpp: (name: string) => RestFiles.use((files) => files.cpp(name)),
};

// RPC answers with the success struct; its contents make it look like REST.
const contents = (success: ReadFile.Success) => success.contents;

export const rpc = {
	bun: (name: string) =>
		RpcFilesClient.use((client) =>
			Effect.map(client.ReadFileBun({ name }), contents),
		),
	cpp: (name: string) =>
		RpcFilesClient.use((client) =>
			Effect.map(client.ReadFileCpp({ name }), contents),
		),
};

/** Whatever any of the calls can fail with. */
export type ReadFailure = Effect.Error<
	ReturnType<(typeof rest | typeof rpc)[Reader]>
>;

/**
 * What the page says when a call fails. The domain errors say it themselves;
 * the transport errors are the client's own, so their wording lives here.
 */
export const describeFailure = Match.type<ReadFailure>().pipe(
	Match.tag(
		"HttpClientError",
		"SchemaError",
		"RpcClientError",
		(error) => `Request failed: ${error.message}`,
	),
	Match.orElse((error) => error.message),
);
