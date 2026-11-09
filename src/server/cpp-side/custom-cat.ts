import { Context, Effect, Layer } from "effect";
import { CustomCat } from "../../shared/generated/generated.ts";
import type { CliFailed } from "../../shared/helpers/cli-failed.ts";
import { type CliOptions, cliRunner } from "./cli.ts";

// Named for the CLI it runs: CustomCat is already the generated namespace.
export class CustomCatCli extends Context.Service<
	CustomCatCli,
	{
		readonly run: (
			request: CustomCat.Request,
		) => Effect.Effect<CustomCat.Success, CustomCat.Failure | CliFailed>;
	}
>()("effect-playground/CustomCatCli") {
	static layerWith(options: CliOptions) {
		return Layer.effect(
			CustomCatCli,
			cliRunner<CustomCat.Request, typeof CustomCat.Output>(
				"custom_cat",
				CustomCat.Output,
				options,
			).pipe(Effect.map((run) => CustomCatCli.of({ run }))),
		);
	}

	static readonly layer = CustomCatCli.layerWith({});
}
