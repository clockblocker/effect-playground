import { join } from "node:path";
import { Context, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { CustomCat } from "../shared/generated/protocol.ts";

const root = join(import.meta.dirname, "../..");

const decodeSuccess = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CustomCat.Success),
);
const decodeInvalidRequest = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CustomCat.InvalidRequest),
);

const text = (stream: Stream.Stream<Uint8Array, unknown>) =>
	stream.pipe(Stream.decodeText(), Stream.mkString);

// Named for the CLI it runs: CustomCat is already the generated namespace.
export class CustomCatCli extends Context.Service<
	CustomCatCli,
	{
		readonly run: (
			request: CustomCat.Request,
		) => Effect.Effect<CustomCat.Success, CustomCat.Failure>;
	}
>()("effect-playground/CustomCatCli") {
	/** Runs cpp/build/custom_cat in `directory`, whose files/ it copies in. */
	static layerIn(directory: string) {
		return Layer.effect(
			CustomCatCli,
			Effect.gen(function* () {
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

				const run = Effect.fn("CustomCatCli.run")(function* ({
					inputFile,
					outputFile,
				}: CustomCat.Request) {
					const child = yield* spawner
						.spawn(
							ChildProcess.make(
								join(root, "cpp/build/custom_cat"),
								[
									`--input-file=${inputFile}`,
									`--output-file=${outputFile}`,
								],
								{ cwd: directory },
							),
						)
						.pipe(Effect.orDie);
					const [stdout, stderr, exitCode] = yield* Effect.all(
						[
							text(child.stdout),
							text(child.stderr),
							child.exitCode,
						],
						{ concurrency: "unbounded" },
					).pipe(Effect.orDie);

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
						default:
							return yield* Effect.die(
								new Error(
									`custom_cat exited with ${exitCode}: ${stderr.trim()}`,
								),
							);
					}
				}, Effect.scoped);

				return CustomCatCli.of({ run });
			}),
		);
	}

	static readonly layer = CustomCatCli.layerIn(root);
}
