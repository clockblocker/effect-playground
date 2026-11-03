import { join } from "node:path";
import { Context, Effect, FileSystem, Layer, Option, Path } from "effect";
import { IssueMessage, ReadFile } from "../shared/generated/protocol.ts";

const invalidName = (
	code: "NotTxtFile" | "LeavesFiles" | "FileNotFound",
	name: string,
) =>
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
	/** Reads the files in `root`'s files/. */
	static layerIn(root: string) {
		return Layer.effect(
			BffReader,
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const directory = path.join(root, "files");

				// As custom_cat's NotALink: any link, even one that stays in
				// files/, and anything that resolves outside it.
				const leavesFiles = Effect.fn(function* (file: string) {
					const link = yield* fs.readLink(file).pipe(
						Effect.as(true),
						Effect.orElseSucceed(() => false),
					);
					if (link) return true;
					const resolved = yield* Effect.option(fs.realPath(file));
					if (Option.isNone(resolved)) return false;
					const inside = yield* fs
						.realPath(directory)
						.pipe(Effect.orDie);
					return path.dirname(resolved.value) !== inside;
				});

				const read = Effect.fn("BffReader.read")(function* (
					name: string,
				) {
					if (path.extname(name) !== ".txt") {
						return yield* invalidName("NotTxtFile", name);
					}
					const file = path.join(directory, name);
					if (yield* leavesFiles(file)) {
						return yield* invalidName("LeavesFiles", name);
					}
					const contents = yield* fs.readFileString(file).pipe(
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

	static readonly layer = BffReader.layerIn(
		join(import.meta.dirname, "../.."),
	);
}
