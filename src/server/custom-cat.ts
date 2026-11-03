import { join } from "node:path";
import {
	Context,
	Data,
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

/**
 * custom_cat's output doesn't match the protocol: the BFF and custom_cat
 * disagree. A defect, never a failure, since no caller can act on it.
 */
export class ContractMismatch extends Data.TaggedError("ContractMismatch")<{
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly issue: string;
}> {
	override get message(): string {
		return `custom_cat's output doesn't match the protocol (exit ${this.exitCode}): ${this.issue}`;
	}
}

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

						const mismatch = (issue: string) => {
							const defect = new ContractMismatch({
								exitCode,
								stdout,
								stderr,
								issue,
							});
							return Effect.logError(defect.message, defect).pipe(
								Effect.andThen(Effect.die(defect)),
							);
						};
						const decoded = <A>(
							effect: Effect.Effect<A, Schema.SchemaError>,
						) =>
							effect.pipe(
								Effect.catchTag("SchemaError", ({ message }) =>
									mismatch(message),
								),
							);

						switch (exitCode) {
							case 0:
								return yield* decoded(decodeSuccess(stdout));
							case 1:
								return yield* Effect.fail(
									yield* decoded(
										decodeInvalidRequest(stdout),
									),
								);
							case 2:
								return yield* mismatch(
									`custom_cat rejected its arguments: ${stderr.trim()}`,
								);
							case 3:
								return yield* Effect.fail(
									yield* decoded(decodeIoFailed(stdout)),
								);
							case 4:
								return yield* Effect.die(
									new Error(
										`custom_cat failed: ${stderr.trim()}`,
									),
								);
							default:
								return yield* mismatch(
									`${exitCode} isn't one of custom_cat's exit codes`,
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
