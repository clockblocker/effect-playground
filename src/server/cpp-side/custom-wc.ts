import { Context, Effect, Layer } from "effect";
import { CustomWc } from "../../shared/generated/generated.ts";
import type { CliFailed } from "../../shared/helpers/tagged-errors.ts";
import { type CliOptions, cliRunner } from "./cli.ts";

// Named for the CLI it runs: CustomWc is already the generated namespace.
export class CustomWcCli extends Context.Service<
	CustomWcCli,
	{
		readonly run: (
			request: CustomWc.Request,
		) => Effect.Effect<CustomWc.Success, CustomWc.Failure | CliFailed>;
	}
>()("effect-playground/CustomWcCli") {
	static layerWith(options: CliOptions) {
		return Layer.effect(
			CustomWcCli,
			cliRunner<CustomWc.Request, typeof CustomWc.Output>(
				"custom_wc",
				CustomWc.Output,
				options,
			).pipe(Effect.map((run) => CustomWcCli.of({ run }))),
		);
	}

	static readonly layer = CustomWcCli.layerWith({});
}
