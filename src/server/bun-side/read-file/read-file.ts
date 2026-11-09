import { getSystemErrorMessage } from "node:util";
import {
	Context,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	type PlatformError,
	Schema,
} from "effect";
import { ReadFile } from "../../../shared/generated/generated.ts";

const invalidName = (message: string) =>
	new ReadFile.InvalidRequest({ issues: [{ message, path: ["name"] }] });

const checkName = Schema.decodeUnknownEffect(ReadFile.Request.fields.name);

// What the system said, as custom_cat's IoFailed does: the errno's message.
const systemMessage = (
	error: Pick<PlatformError.PlatformError, "message" | "reason">,
) => {
	const cause = error.reason.cause;
	const errno =
		cause instanceof Error && "errno" in cause ? cause.errno : undefined;
	return typeof errno === "number"
		? getSystemErrorMessage(errno)
		: error.message;
};

export class ReadFileBff extends Context.Service<
	ReadFileBff,
	{
		readonly run: (
			request: ReadFile.RequestShape,
		) => Effect.Effect<ReadFile.Success, ReadFile.Failure>;
	}
>()("effect-playground/ReadFileBff") {
	/** Reads the files in `root`'s files/. */
	static layerIn(root: string) {
		return Layer.effect(
			ReadFileBff,
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

				const run = Effect.fn("ReadFileBff.run")(function* ({
					name,
				}: ReadFile.RequestShape) {
					yield* checkName(name).pipe(
						Effect.mapError(({ message }) => invalidName(message)),
					);
					const file = path.join(directory, name);
					if (yield* leavesFiles(file)) {
						return yield* invalidName(
							`"${name}" is a link, which could lead outside the files directory`,
						);
					}
					const contents = yield* fs.readFileString(file).pipe(
						Effect.catchReason(
							"PlatformError",
							"NotFound",
							(_, error) =>
								Effect.fail(invalidName(systemMessage(error))),
							(_, error) =>
								Effect.fail(
									new ReadFile.IoFailed({
										message: systemMessage(error),
									}),
								),
						),
					);
					return { contents };
				});

				return ReadFileBff.of({ run });
			}),
		);
	}

	// files/ under the working directory, as the core's: a compiled BFF has
	// no source tree to find it from.
	static readonly layer = ReadFileBff.layerIn(process.cwd());
}
