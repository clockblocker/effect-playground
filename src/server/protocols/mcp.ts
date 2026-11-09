import { Effect, Layer } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import { CustomCat, CustomWc } from "../../shared/generated/generated.ts";
import { fieldOf } from "../../shared/helpers/field-of.ts";
import { cppSideFailure } from "../../shared/helpers/tagged-errors.ts";
import { Core } from "../cpp-side/core.ts";

type Issues = ReadonlyArray<{
	readonly path: ReadonlyArray<string | number>;
	readonly message: string;
}>;

// McpServer makes a failure's message the tool error's text, and an MCP
// client has no form to put each issue under, so an operation's
// InvalidRequest, whichever it is, names each field in its text. Any other
// failure's message reads as it is.
const forTool = <R, A, E>(
	run: (request: R) => Effect.Effect<A, E>,
	// biome-ignore lint/suspicious/noExplicitAny: a class to extend takes any arguments.
	InvalidRequest: new (...args: any[]) => { readonly issues: Issues },
) => {
	class ToolInvalidRequest extends InvalidRequest {
		get message(): string {
			return this.issues
				.map(({ path, message }) => `${fieldOf(path)}: ${message}`)
				.join("\n");
		}
	}
	return (request: R) =>
		run(request).pipe(
			Effect.mapError((error) =>
				error instanceof InvalidRequest
					? (new ToolInvalidRequest({ issues: error.issues }) as E)
					: error,
			),
		);
};

// By shape alone: the C++ checks the rules.
const CustomCatTool = Tool.make("custom_cat", {
	description:
		"Copies a .txt file in the files directory to another .txt file there, " +
		"replacing it if it exists.",
	parameters: CustomCat.RequestShape,
	success: CustomCat.Success,
	failure: cppSideFailure(CustomCat.Failure),
});

const CustomWcTool = Tool.make("custom_wc", {
	description:
		"Counts the lines, words and bytes of a .txt file in the files directory.",
	parameters: CustomWc.RequestShape,
	success: CustomWc.Success,
	failure: cppSideFailure(CustomWc.Failure),
});

const Tools = Toolkit.make(CustomCatTool, CustomWcTool);

const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const core = yield* Core;
		return Tools.of({
			custom_cat: forTool(
				(request: CustomCat.RequestShape) =>
					core.call((operations) => operations.CustomCat(request)),
				CustomCat.InvalidRequest,
			),
			custom_wc: forTool(
				(request: CustomWc.RequestShape) =>
					core.call((operations) => operations.CustomWc(request)),
				CustomWc.InvalidRequest,
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
