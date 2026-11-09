import { join } from "node:path";
import {
	Context,
	Data,
	Duration,
	Effect,
	Layer,
	Match,
	type PlatformError,
	Schema,
	Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { CliFailed } from "../../shared/helpers/cli-failed.ts";
import { CustomCat } from "../../shared/generated/protocol.ts";

const root = join(import.meta.dirname, "../../..");

const decodeOutput = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CustomCat.Output),
);

// The exit codes whose stdout is an Output, and the tag it must have.
const outputTags: Partial<Record<number, CustomCat.Output["_tag"]>> = {
	0: "Success",
	1: "InvalidRequest",
	3: "IoFailed",
};

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

const notStarted = ({ message }: PlatformError.PlatformError) =>
	new CliFailed({ message });

// The spawner reports an exit by a signal as a PlatformError whose cause
// names the signal.
const killed = (error: PlatformError.PlatformError) => {
	const cause = error.reason.cause;
	return new CliFailed({
		message: cause instanceof Error ? cause.message : error.message,
	});
};

interface Options {
	/** Where custom_cat runs; it copies in its files/. */
	readonly directory?: string;
	readonly binary?: string;
	/** How long a run may take before it's killed and fails as CliFailed. */
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

						switch (exitCode) {
							case 2:
								return yield* mismatch(
									`custom_cat rejected its arguments: ${stderr.trim()}`,
								);
							case 4:
								return yield* Effect.die(
									new Error(
										`custom_cat failed: ${stderr.trim()}`,
									),
								);
						}
						const tag = outputTags[exitCode];
						if (tag === undefined) {
							return yield* mismatch(
								`${exitCode} isn't one of custom_cat's exit codes`,
							);
						}
						const output = yield* decodeOutput(stdout).pipe(
							Effect.catchTag("SchemaError", ({ message }) =>
								mismatch(message),
							),
						);
						if (output._tag !== tag) {
							return yield* mismatch(
								`exit ${exitCode} printed ${output._tag}, not ${tag}`,
							);
						}
						return yield* Match.valueTags(output, {
							Success: ({ bytesCopied }) =>
								Effect.succeed({ bytesCopied }),
							InvalidRequest: Effect.fail,
							IoFailed: Effect.fail,
						});
					},
					Effect.scoped,
					Effect.timeoutOrElse({
						duration: timeout,
						orElse: () =>
							Effect.fail(
								new CliFailed({
									message: `custom_cat timed out after ${millis} ms`,
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
