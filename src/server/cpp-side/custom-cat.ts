import { Context, Effect, Layer } from "effect";
import { CustomCat } from "../../shared/generated/generated.ts";
import type { CppSideFailure } from "../../shared/helpers/tagged-errors.ts";
import { type CliOptions, cliRunner } from "./cli.ts";

// Named for the CLI it runs: CustomCat is already the generated namespace.
export class CustomCatCli extends Context.Service<
	CustomCatCli,
	{
		readonly run: (
			request: CustomCat.Request,
		) => Effect.Effect<
			CustomCat.Success,
			CppSideFailure<CustomCat.Failure>
		>;
	}
>()("effect-playground/CustomCatCli") {
	static layerWith(options: CliOptions) {
		return Layer.effect(
			CustomCatCli,
			cliRunner<CustomCat.Request, typeof CustomCat>(
				"custom_cat",
				CustomCat,
				options,
			).pipe(Effect.map((run) => CustomCatCli.of({ run }))),
		);
	}

	static readonly layer = CustomCatCli.layerWith({});
}
