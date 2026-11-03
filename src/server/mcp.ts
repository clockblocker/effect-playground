import { Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import { CliFailed } from "../shared/cli-failed.ts";
import { CustomCat, fieldOf } from "../shared/generated/protocol.ts";
import { CustomCatCli } from "./custom-cat.ts";

// McpServer makes a failure's message the tool error's text, and an MCP
// client has no form to put each issue under, so its text names each field.
// Any other failure's message reads as it is.
class ToolInvalidRequest extends CustomCat.InvalidRequest {
	override get message(): string {
		return this.issues
			.map(({ path, message }) => `${fieldOf(path)}: ${message}`)
			.join("\n");
	}
}

const CustomCatTool = Tool.make("custom_cat", {
	description:
		"Copies a .txt file in the files directory to another .txt file there, " +
		"replacing it if it exists.",
	parameters: CustomCat.Request,
	success: CustomCat.Success,
	failure: Schema.Union([CustomCat.Failure, CliFailed]),
});

const Tools = Toolkit.make(CustomCatTool);

const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const cli = yield* CustomCatCli;
		return Tools.of({
			custom_cat: (request) =>
				cli
					.run(request)
					.pipe(
						Effect.catchTag("InvalidRequest", ({ issues }) =>
							Effect.fail(new ToolInvalidRequest({ issues })),
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
