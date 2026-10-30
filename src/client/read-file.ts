import { Effect, type Schema } from "effect";
import type { HttpClientError } from "effect/http";
import type { RpcClientError } from "effect/rpc";
import type {
	FileNotFound,
	NotTxtFile,
	ReaderUnavailable,
} from "../shared/errors.ts";
import type { Reader } from "../shared/reader.ts";
import { RestFiles, RpcFilesClient } from "./clients.ts";

/** How the page names each reader. */
export const readerLabels: Record<Reader, string> = { bun: "Bun", cpp: "C++" };

export type Outcome =
	| { readonly kind: "contents"; readonly text: string }
	| { readonly kind: "error"; readonly message: string };

const contents = (text: string): Outcome => ({ kind: "contents", text });
const failed = (message: string) =>
	Effect.succeed<Outcome>({ kind: "error", message });
const notTxt = (error: NotTxtFile) =>
	failed(`"${error.name}" is not a .txt file`);
const notFound = (error: FileNotFound) =>
	failed(`"${error.name}" does not exist`);
const unavailable = (error: ReaderUnavailable) =>
	failed(
		`The ${readerLabels[error.reader]} reader is unavailable: ${error.message}`,
	);
// Each transport's own errors and nothing else, so a domain error that
// catchTags misses is a compile error rather than a silent "Request failed".
const requestFailed = (error: { readonly message: string }) =>
	failed(`Request failed: ${error.message}`);
const restFailed = (
	error: HttpClientError.HttpClientError | Schema.SchemaError,
) => requestFailed(error);
const rpcFailed = (error: RpcClientError.RpcClientError) =>
	requestFailed(error);

// Hover `read` in each function: the error channel lists that reader's domain
// errors plus what the transport can fail with. catchTags covers the domain
// errors (and rejects a tag the reader can't fail with, so the Bun functions
// can't name ReaderUnavailable); Effect.catch takes the transport's.

export const rest: Record<
	Reader,
	(name: string) => Effect.Effect<Outcome, never, RestFiles>
> = {
	bun: (name) =>
		Effect.gen(function* () {
			const files = yield* RestFiles;
			const read = files.bun(name);
			return yield* read.pipe(
				Effect.map(contents),
				Effect.catchTags({
					NotTxtFile: notTxt,
					FileNotFound: notFound,
				}),
				Effect.catch(restFailed),
			);
		}),
	cpp: (name) =>
		Effect.gen(function* () {
			const files = yield* RestFiles;
			const read = files.cpp(name);
			return yield* read.pipe(
				Effect.map(contents),
				Effect.catchTags({
					NotTxtFile: notTxt,
					FileNotFound: notFound,
					ReaderUnavailable: unavailable,
				}),
				Effect.catch(restFailed),
			);
		}),
};

export const rpc: Record<
	Reader,
	(name: string) => Effect.Effect<Outcome, never, RpcFilesClient>
> = {
	bun: (name) =>
		Effect.gen(function* () {
			const client = yield* RpcFilesClient;
			const read = client.ReadFileBun({ name });
			return yield* read.pipe(
				Effect.map((success) => contents(success.contents)),
				Effect.catchTags({
					NotTxtFile: notTxt,
					FileNotFound: notFound,
				}),
				Effect.catch(rpcFailed),
			);
		}),
	cpp: (name) =>
		Effect.gen(function* () {
			const client = yield* RpcFilesClient;
			const read = client.ReadFileCpp({ name });
			return yield* read.pipe(
				Effect.map((success) => contents(success.contents)),
				Effect.catchTags({
					NotTxtFile: notTxt,
					FileNotFound: notFound,
					ReaderUnavailable: unavailable,
				}),
				Effect.catch(rpcFailed),
			);
		}),
};
