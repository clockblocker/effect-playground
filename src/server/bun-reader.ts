import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { FileNotFound, NotTxtFile } from "../shared/errors.ts";
import type { ReadFileSuccess } from "../shared/generated/reader-protocol.ts";

// The Bun reader: the file system through Effect. Its C++ twin is
// cpp/src/read_file.cpp.
export class BunReader extends Context.Service<
	BunReader,
	{
		readonly read: (
			name: string,
		) => Effect.Effect<ReadFileSuccess, NotTxtFile | FileNotFound>;
	}
>()("effect-playground/BunReader") {
	static readonly layer = Layer.effect(
		BunReader,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const directory = path.join(import.meta.dirname, "../../files");

			const read = Effect.fn("BunReader.read")(function* (name: string) {
				if (path.extname(name) !== ".txt") {
					return yield* new NotTxtFile({ name });
				}
				// basename keeps "../../etc/passwd.txt" inside the files folder.
				const contents = yield* fs
					.readFileString(path.join(directory, path.basename(name)))
					.pipe(
						Effect.catchReason(
							"PlatformError",
							"NotFound",
							() => Effect.fail(new FileNotFound({ name })),
							// Any other reason (permissions, a directory named x.txt) is
							// a bug, not a case the client handles: make it a defect.
							Effect.die,
						),
					);
				return { contents };
			});

			return BunReader.of({ read });
		}),
	);
}
