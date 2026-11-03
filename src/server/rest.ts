import { Effect, Layer, Schema, SchemaIssue } from "effect";
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
import {
	BffApi,
	CustomCatSchemaErrors,
	ReadFileSchemaErrors,
} from "../shared/rest-api.ts";
import { BffReader } from "./bff-reader.ts";
import { CustomCatCli } from "./custom-cat.ts";

const standardIssues = SchemaIssue.makeFormatterStandardSchemaV1({
	leafHook: (leaf) =>
		leaf._tag === "MissingKey"
			? IssueMessage.Missing()
			: leaf._tag === "UnexpectedKey"
				? "Unknown field"
				: SchemaIssue.defaultLeafHook(leaf),
});

/**
 * Any request that doesn't decode, as the method's InvalidRequest. An issue
 * off the method's paths, such as an unknown field's, goes on the whole
 * request, its message saying where.
 */
const asInvalidRequest = <I>(method: {
	readonly InvalidRequest: Schema.Decoder<I>;
	readonly Path: Schema.Top;
}) => {
	const decode = Schema.decodeUnknownEffect(method.InvalidRequest);
	const isPath: (path: unknown) => boolean = Schema.is(method.Path);
	return (error: HttpApiError.HttpApiSchemaError) =>
		decode({
			_tag: "InvalidRequest",
			issues: standardIssues(error.cause.issue).issues.map(
				({ message, path = [] }) =>
					isPath(path)
						? { message, path }
						: {
								message: `${path.join(".")}: ${message}`,
								path: [],
							},
			),
		}).pipe(Effect.orDie, Effect.flip);
};

const SchemaErrorLayers = Layer.mergeAll(
	HttpApiMiddleware.layerSchemaErrorTransform(
		ReadFileSchemaErrors,
		asInvalidRequest(ReadFile),
	),
	HttpApiMiddleware.layerSchemaErrorTransform(
		CustomCatSchemaErrors,
		asInvalidRequest(CustomCat),
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
	Layer.provide(SchemaErrorLayers),
);
