import { join } from "node:path";
import {
	Data,
	Duration,
	Effect,
	type PlatformError,
	Schema,
	Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { CliFailed } from "../../shared/helpers/cli-failed.ts";

const root = join(import.meta.dirname, "../../..");

// The exit codes whose stdout is an Output, and the tag it must have: every
// operation's executable runs through cpp/include/run.hpp. Exit 4 is a bug.
const outputTags: Partial<Record<number, string>> = {
	0: "Success",
	1: "InvalidRequest",
	3: "IoFailed",
};

/**
 * An executable's output doesn't match the protocol: the BFF and it
 * disagree. A defect, never a failure, since no caller can act on it.
 */
export class ContractMismatch extends Data.TaggedError("ContractMismatch")<{
	readonly executable: string;
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly issue: string;
}> {
	override get message(): string {
		return `${this.executable}'s output doesn't match the protocol (exit ${this.exitCode}): ${this.issue}`;
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

/** `inputFile` → `input-file`, as reflect-cpp's CLI reader spells a field. */
const flag = (field: string) =>
	field.replaceAll(/([A-Z])/g, (letter) => `-${letter.toLowerCase()}`);

export interface CliOptions {
	/** Where the executable runs; it works in its files/. */
	readonly directory?: string;
	/** The executable, `cpp/build/<executable>` by default. */
	readonly binary?: string;
	/** How long a run may take before it's killed and fails as CliFailed. */
	readonly timeout?: Duration.Input;
}

/** An operation's Output: its success, tagged "Success", or a failure. */
type OutputSchema = Schema.Decoder<{ readonly _tag: string }> & {
	readonly DecodingServices: never;
};

type SuccessOf<O> = Omit<Extract<O, { readonly _tag: "Success" }>, "_tag">;
type FailureOf<O> = Exclude<O, { readonly _tag: "Success" }>;

/**
 * Runs `executable`, a C++ operation, with a request's fields as its flags,
 * and decodes what it prints with the operation's `Output`: its success,
 * without its tag, or its failure. Exit 4, a bug in the executable, is a
 * defect, and output the protocol doesn't have a ContractMismatch.
 */
export const cliRunner = Effect.fnUntraced(function* <
	Request extends object,
	S extends OutputSchema,
>(
	executable: string,
	output: S,
	{
		directory = root,
		binary = join(root, "cpp/build", executable),
		timeout = Duration.seconds(5),
	}: CliOptions,
) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const decodeOutput = Schema.decodeUnknownEffect(
		Schema.fromJsonString(output),
	);
	const millis = Duration.toMillis(timeout);

	return Effect.fn(`${executable}.run`)(
		function* (request: Request) {
			// Closing the scope, on success, failure or interruption, kills the
			// process if it still runs.
			const child = yield* spawner
				.spawn(
					ChildProcess.make(
						binary,
						Object.entries(request).map(
							([field, value]) =>
								`--${flag(field)}=${String(value)}`,
						),
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
					executable,
					exitCode,
					stdout,
					stderr,
					issue,
				});
				return Effect.logError(defect.message, defect).pipe(
					Effect.andThen(Effect.die(defect)),
				);
			};

			if (exitCode === 4) {
				return yield* Effect.die(
					new Error(`${executable} failed: ${stderr.trim()}`),
				);
			}
			const tag = outputTags[exitCode];
			if (tag === undefined) {
				return yield* mismatch(
					`${exitCode} isn't one of ${executable}'s exit codes`,
				);
			}
			const printed: S["Type"] = yield* decodeOutput(stdout).pipe(
				Effect.catchTag("SchemaError", ({ message }) =>
					mismatch(message),
				),
			);
			if (printed._tag !== tag) {
				return yield* mismatch(
					`exit ${exitCode} printed ${printed._tag}, not ${tag}`,
				);
			}
			if (printed._tag !== "Success") {
				return yield* Effect.fail(printed as FailureOf<S["Type"]>);
			}
			const { _tag: _, ...success } = printed;
			return success as SuccessOf<S["Type"]>;
		},
		Effect.scoped,
		Effect.timeoutOrElse({
			duration: timeout,
			orElse: () =>
				Effect.fail(
					new CliFailed({
						message: `${executable} timed out after ${millis} ms`,
					}),
				),
		}),
	);
});
