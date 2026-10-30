import { Context, Effect, Layer } from "effect";
import type {
	FileNotFound,
	NotTxtFile,
	ReaderUnavailable,
} from "../shared/errors.ts";
import type { ReadFileSuccess } from "../shared/generated/reader-protocol.ts";
import type { Reader } from "../shared/reader.ts";
import { BunReader } from "./bun-reader.ts";
import { CppReader } from "./cpp-reader.ts";

// What both transports call: it routes each request to the reader it names,
// and knows nothing about the file system or the wire.
export class FileReader extends Context.Service<
	FileReader,
	{
		readonly read: (request: {
			readonly name: string;
			readonly reader: Reader;
		}) => Effect.Effect<
			ReadFileSuccess,
			NotTxtFile | FileNotFound | ReaderUnavailable
		>;
	}
>()("effect-playground/FileReader") {
	static readonly layer = Layer.effect(
		FileReader,
		Effect.gen(function* () {
			const readers = { bun: yield* BunReader, cpp: yield* CppReader };
			return FileReader.of({
				read: ({ name, reader }) => readers[reader].read(name),
			});
		}),
	).pipe(Layer.provide([BunReader.layer, CppReader.layer]));
}
