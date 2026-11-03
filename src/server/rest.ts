import { Effect, Layer, Option, Schema, SchemaIssue } from "effect";
import {
	HttpApiBuilder,
	type HttpApiError,
	HttpApiMiddleware,
} from "effect/http-api";
import {
	CustomCat,
	IssueMessage,
	ReadFile,
} from "../shared/generated/protocol.ts";
import { BffApi, CustomCatRules, ReadFileRules } from "../shared/rest-api.ts";
import { BffReader } from "./bff-reader.ts";
import { CustomCatCli } from "./custom-cat.ts";

const messages = SchemaIssue.makeFormatterStandardSchemaV1({
	leafHook: (leaf) =>
		leaf._tag === "MissingKey"
			? IssueMessage.Missing()
			: SchemaIssue.defaultLeafHook(leaf),
});

// The same walk, so the same issues in the same order, each worded by its
// code: the generator annotates each check with its rule's.
const codes = SchemaIssue.makeFormatterStandardSchemaV1({
	checkHook: ({ filter }) => {
		const code = filter.annotations?.issueCode;
		return typeof code === "string" ? code : "";
	},
	leafHook: (leaf) => (leaf._tag === "MissingKey" ? "Missing" : ""),
});

/** The method's InvalidRequest, if every issue has a code; else the 400. */
const rulesAsInvalidRequest =
	<A>(decode: (input: unknown) => Option.Option<A>) =>
	(error: HttpApiError.HttpApiSchemaError) => {
		const { issue } = error.cause;
		const coded = codes(issue).issues;
		const invalid = decode({
			_tag: "InvalidRequest",
			issues: messages(issue).issues.map(({ message, path }, index) => ({
				code: coded[index]?.message,
				message,
				path,
			})),
		});
		return Option.isSome(invalid)
			? Effect.fail(invalid.value)
			: Effect.fail(error);
	};

const RulesLayers = Layer.mergeAll(
	HttpApiMiddleware.layerSchemaErrorTransform(
		ReadFileRules,
		rulesAsInvalidRequest(
			Schema.decodeUnknownOption(ReadFile.InvalidRequest),
		),
	),
	HttpApiMiddleware.layerSchemaErrorTransform(
		CustomCatRules,
		rulesAsInvalidRequest(
			Schema.decodeUnknownOption(CustomCat.InvalidRequest),
		),
	),
);

const FilesHandlers = HttpApiBuilder.group(
	BffApi,
	"files",
	Effect.fn(function* (handlers) {
		const reader = yield* BffReader;
		const cli = yield* CustomCatCli;
		return handlers
			.handle("read", ({ params }) =>
				reader
					.read(params.name)
					.pipe(Effect.map(({ contents }) => contents)),
			)
			.handle("copy", ({ payload }) => cli.run(payload));
	}),
);

export const RestRoutes = HttpApiBuilder.layer(BffApi).pipe(
	Layer.provide(FilesHandlers),
	Layer.provide(RulesLayers),
);
