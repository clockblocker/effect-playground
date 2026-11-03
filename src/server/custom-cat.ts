import { join } from "node:path";
import {
	Context,
	Duration,
	Effect,
	Layer,
	type PlatformError,
	Schema,
	Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { CliFailed } from "../shared/cli-failed.ts";
import { CustomCat, IoFailed } from "../shared/generated/protocol.ts";

const root = join(import.meta.dirname, "../..");

const decodeSuccess = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CustomCat.Success),
);
const decodeInvalidRequest = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CustomCat.InvalidRequest),
);
const decodeIoFailed = Schema.decodeUnknownEffect(
	Schema.fromJsonString(IoFailed),
);

const text = (stream: Stream.Stream<Uint8Array, unknown>) =>
	stream.pipe(Stream.decodeText(), Stream.mkString);

const notStarted = (error: PlatformError.PlatformError) => {
	switch (error.reason._tag) {
		case "NotFound":
			return new CliFailed({ reason: { _tag: "NotFound" } });
		case "PermissionDenied":
			return new CliFailed({ reason: { _tag: "NotExecutable" } });
		default:
			return new CliFailed({
				reason: { _tag: "NotStarted", error: error.message },
			});
	}
};

// The spawner reports an exit by a signal as a PlatformError whose cause
// names the signal.
const killed = (error: PlatformError.PlatformError) => {
	const cause = error.reason.cause;
	const signal =
		cause instanceof Error
			? /signal: '(\w+)'/.exec(cause.message)?.[1]
			: "";
	return new CliFailed({
		reason: { _tag: "Killed", signal: signal || "a signal" },
	});
};

interface Options {
	/** Where custom_cat runs; it copies in its files/. */
	readonly directory?: string;
	readonly binary?: string;
	/** How long a run may take before it's killed and fails as TimedOut. */
	readonly timeout?: Duration.Input;
}

// Named for the CLI it runs: CustomCat is already the generated namespace.
export class CustomCatCli extends Context.Service<
	CustomCatCli,
	{
		readonly run: (
			request: CustomCat.Request,
		) => Effect.Effect<CustomCat.Success, CustomCat.Failure | CliFailed>;
	}
>()("effect-playground/CustomCatCli") {
	static layerWith({
		directory = root,
		binary = join(root, "cpp/build/custom_cat"),
		timeout = Duration.seconds(5),
	}: Options) {
		return Layer.effect(
			CustomCatCli,
			Effect.gen(function* () {
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
				const millis = Duration.toMillis(timeout);

				const run = Effect.fn("CustomCatCli.run")(
					function* ({ inputFile, outputFile }: CustomCat.Request) {
						// Closing the scope, on success, failure or interruption,
						// kills the process if it still runs.
						const child = yield* spawner
							.spawn(
								ChildProcess.make(
									binary,
									[
										`--input-file=${inputFile}`,
										`--output-file=${outputFile}`,
									],
									{
										cwd: directory,
										killSignal: "SIGTERM",
										forceKillAfter: Duration.seconds(1),
									},
								),
							)
							.pipe(Effect.mapError(notStarted));
						const [stdout, stderr, exitCode] = yield* Effect.all(
							[
								text(child.stdout).pipe(Effect.orDie),
								text(child.stderr).pipe(Effect.orDie),
								child.exitCode.pipe(Effect.mapError(killed)),
							],
							{ concurrency: "unbounded" },
						);

						switch (exitCode) {
							case 0:
								return yield* decodeSuccess(stdout).pipe(
									Effect.orDie,
								);
							case 1:
								return yield* Effect.fail(
									yield* decodeInvalidRequest(stdout).pipe(
										Effect.orDie,
									),
								);
							case 3:
								return yield* Effect.fail(
									yield* decodeIoFailed(stdout).pipe(
										Effect.orDie,
									),
								);
							default:
								return yield* Effect.die(
									new Error(
										`custom_cat exited with ${exitCode}: ${stderr.trim()}`,
									),
								);
						}
					},
					Effect.scoped,
					Effect.timeoutOrElse({
						duration: timeout,
						orElse: () =>
							Effect.fail(
								new CliFailed({
									reason: { _tag: "TimedOut", millis },
								}),
							),
					}),
				);

				return CustomCatCli.of({ run });
			}),
		);
	}

	static readonly layer = CustomCatCli.layerWith({});
}
