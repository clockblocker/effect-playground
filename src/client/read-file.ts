import { Effect } from "effect";
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
const transport = (error: Error) => failed(`Request failed: ${error.message}`);

// Hover `read` in each function: the error channel lists the three domain
// errors plus what the transport can fail with. catchTags must cover
// NotTxtFile, FileNotFound and ReaderUnavailable, and Effect.catch takes
// whatever is left.

export const readViaRest = (name: string, reader: Reader) =>
	Effect.gen(function* () {
		const files = yield* RestFiles;
		const read = files.read(name, reader);
		return yield* read.pipe(
			Effect.map(contents),
			Effect.catchTags({
				NotTxtFile: notTxt,
				FileNotFound: notFound,
				ReaderUnavailable: unavailable,
			}),
			Effect.catch(transport),
		);
	});

export const readViaRpc = (name: string, reader: Reader) =>
	Effect.gen(function* () {
		const client = yield* RpcFilesClient;
		const read = client.ReadFile({ name, reader });
		return yield* read.pipe(
			Effect.map((success) => contents(success.contents)),
			Effect.catchTags({
				NotTxtFile: notTxt,
				FileNotFound: notFound,
				ReaderUnavailable: unavailable,
			}),
			Effect.catch(transport),
		);
	});
