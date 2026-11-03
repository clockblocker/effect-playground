import { Effect, Layer } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import { CustomCat } from "../shared/generated/protocol.ts";
import { CustomCatCli } from "./custom-cat.ts";

const CustomCatTool = Tool.make("custom_cat", {
	description:
		"Copies a .txt file in the files directory to another .txt file there, " +
		"replacing it if it exists.",
	parameters: CustomCat.Request,
	success: CustomCat.Success,
	failure: CustomCat.Failure,
});

const Tools = Toolkit.make(CustomCatTool);

const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const cli = yield* CustomCatCli;
		return Tools.of({ custom_cat: (request) => cli.run(request) });
	}),
);

// A failure's message becomes the tool error's text.
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
