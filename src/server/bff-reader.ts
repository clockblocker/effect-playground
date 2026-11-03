import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { IssueMessage, ReadFile } from "../shared/generated/protocol.ts";

const invalidName = (code: "NotTxtFile" | "FileNotFound", name: string) =>
	new ReadFile.InvalidRequest({
		issues: [
			{
				code,
				message: IssueMessage[code]({ value: name }),
				path: ["name"],
			},
		],
	});

export class BffReader extends Context.Service<
	BffReader,
	{
		readonly read: (
			name: string,
		) => Effect.Effect<ReadFile.Success, ReadFile.Failure>;
	}
>()("effect-playground/BffReader") {
	static readonly layer = Layer.effect(
		BffReader,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const directory = path.join(import.meta.dirname, "../../files");

			const read = Effect.fn("BffReader.read")(function* (name: string) {
				if (path.extname(name) !== ".txt") {
					return yield* invalidName("NotTxtFile", name);
				}
				// basename keeps "../../etc/passwd.txt" inside the files folder.
				const contents = yield* fs
					.readFileString(path.join(directory, path.basename(name)))
					.pipe(
						Effect.catchReason(
							"PlatformError",
							"NotFound",
							() =>
								Effect.fail(invalidName("FileNotFound", name)),
							// Any other reason (permissions, a directory named x.txt) is
							// a bug, not a case the client handles: make it a defect.
							Effect.die,
						),
					);
				return { contents };
			});

			return BffReader.of({ read });
		}),
	);
}
