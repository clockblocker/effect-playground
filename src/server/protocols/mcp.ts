import { Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import { CustomCat, CustomWc } from "../../shared/generated/generated.ts";
import { fieldOf } from "../../shared/helpers/field-of.ts";
import { CliFailed } from "../../shared/helpers/tagged-errors.ts";
import { CustomCatCli } from "../cpp-side/custom-cat.ts";
import { CustomWcCli } from "../cpp-side/custom-wc.ts";

// McpServer makes a failure's message the tool error's text, and an MCP
// client has no form to put each issue under, so its text names each field.
// Any other failure's message reads as it is.
const fieldMessages = (
	issues: ReadonlyArray<{
		readonly path: ReadonlyArray<string | number>;
		readonly message: string;
	}>,
) =>
	issues
		.map(({ path, message }) => `${fieldOf(path)}: ${message}`)
		.join("\n");

class CustomCatInvalidRequest extends CustomCat.InvalidRequest {
	override get message(): string {
		return fieldMessages(this.issues);
	}
}

class CustomWcInvalidRequest extends CustomWc.InvalidRequest {
	override get message(): string {
		return fieldMessages(this.issues);
	}
}

// By shape alone: the C++ checks the rules.
const CustomCatTool = Tool.make("custom_cat", {
	description:
		"Copies a .txt file in the files directory to another .txt file there, " +
		"replacing it if it exists.",
	parameters: CustomCat.RequestShape,
	success: CustomCat.Success,
	failure: Schema.Union([CustomCat.Failure, CliFailed]),
});

const CustomWcTool = Tool.make("custom_wc", {
	description:
		"Counts the lines, words and bytes of a .txt file in the files directory.",
	parameters: CustomWc.RequestShape,
	success: CustomWc.Success,
	failure: Schema.Union([CustomWc.Failure, CliFailed]),
});

const Tools = Toolkit.make(CustomCatTool, CustomWcTool);

const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const customCat = yield* CustomCatCli;
		const customWc = yield* CustomWcCli;
		return Tools.of({
			custom_cat: (request) =>
				customCat
					.run(request)
					.pipe(
						Effect.catchTag("InvalidRequest", ({ issues }) =>
							Effect.fail(
								new CustomCatInvalidRequest({ issues }),
							),
						),
					),
			custom_wc: (request) =>
				customWc
					.run(request)
					.pipe(
						Effect.catchTag("InvalidRequest", ({ issues }) =>
							Effect.fail(new CustomWcInvalidRequest({ issues })),
						),
					),
		});
	}),
);

export const McpRoutes = McpServer.toolkit(Tools).pipe(
	Layer.provide(ToolHandlers),
	Layer.provideMerge(
		McpServer.layerHttp({
			name: "effect-playground",
			version: "0.0.0",
			path: "/mcp",
			protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
		}),
	),
);
