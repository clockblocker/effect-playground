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
import { isInvalidRequest } from "../../shared/helpers/procedure.ts";
import { CliFailed } from "../../shared/helpers/tagged-errors.ts";

const root = join(import.meta.dirname, "../../..");

// Every operation's executable runs through cpp/include/run.hpp, which
// exits 0 with its success, 1 with its InvalidRequest and 3 with any other
// error it has. Exit 4 is a bug.
const outputCodes = new Set([0, 1, 3]);

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

/** A C++ operation's namespace, such as CustomCat, as far as the runner reads it. */
interface CppOperation {
	/** What it prints: its success, tagged, or its failure. */
	readonly Output: Schema.Decoder<{ readonly _tag: string }> & {
		readonly DecodingServices: never;
	};
	readonly Success: Schema.Top;
	readonly Failure: Schema.Top;
}

/**
 * Runs `executable`, a C++ operation, with a request's fields as its flags,
 * and decodes what it prints with the operation's `Output`: its success,
 * without its tag, or its failure. Exit 4, a bug in the executable, is a
 * defect, and output the protocol doesn't have a ContractMismatch.
 */
export const cliRunner = Effect.fnUntraced(function* <
	Request extends object,
	Op extends CppOperation,
>(
	executable: string,
	operation: Op,
	{
		directory = root,
		binary = join(root, "cpp/build", executable),
		timeout = Duration.seconds(5),
	}: CliOptions,
) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const decodeOutput = Schema.decodeUnknownEffect(
		Schema.fromJsonString(operation.Output),
	);
	const isFailure = Schema.is(operation.Failure);
	const exitCodeOf = (printed: unknown) =>
		!isFailure(printed) ? 0 : isInvalidRequest(printed) ? 1 : 3;
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
			if (!outputCodes.has(exitCode)) {
				return yield* mismatch(
					`${exitCode} isn't one of ${executable}'s exit codes`,
				);
			}
			const printed = yield* decodeOutput(stdout).pipe(
				Effect.catchTag("SchemaError", ({ message }) =>
					mismatch(message),
				),
			);
			if (exitCodeOf(printed) !== exitCode) {
				return yield* mismatch(
					`exit ${exitCode} printed ${printed._tag}, which exits ${exitCodeOf(printed)}`,
				);
			}
			if (isFailure(printed)) {
				return yield* Effect.fail(printed as Op["Failure"]["Type"]);
			}
			const { _tag: _, ...success }: { readonly _tag: string } = printed;
			return success as Op["Success"]["Type"];
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
