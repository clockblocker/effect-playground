import { join } from "node:path";
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
import { IoFailed, ReadFile } from "../../shared/generated/generated.ts";

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
									new IoFailed({
										message: systemMessage(error),
									}),
								),
						),
					);
					return { contents };
				});

				return BffReader.of({ read });
			}),
		);
	}

	static readonly layer = BffReader.layerIn(
		join(import.meta.dirname, "../../.."),
	);
}
