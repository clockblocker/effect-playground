import { Effect, Layer, Schema, SchemaIssue } from "effect";
import {
	HttpApiBuilder,
	type HttpApiError,
	HttpApiMiddleware,
} from "effect/http-api";
import {
	CustomCat,
	CustomWc,
	SearchFile,
} from "../../shared/generated/generated.ts";
import {
	BffApi,
	CustomCatSchemaErrors,
	CustomWcSchemaErrors,
	SearchFileSchemaErrors,
} from "../../shared/rest-api.ts";
import { ReadFileBff } from "../bun-side/read-file/read-file.ts";
import { SearchFileBff } from "../bun-side/search-file/search-file.ts";
import { CustomCatCli } from "../cpp-side/custom-cat.ts";
import { CustomWcCli } from "../cpp-side/custom-wc.ts";

const standardIssues = SchemaIssue.makeFormatterStandardSchemaV1();

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

const SchemaErrors = Layer.mergeAll(
	HttpApiMiddleware.layerSchemaErrorTransform(
		CustomCatSchemaErrors,
		asInvalidRequest(CustomCat),
	),
	HttpApiMiddleware.layerSchemaErrorTransform(
		CustomWcSchemaErrors,
		asInvalidRequest(CustomWc),
	),
	HttpApiMiddleware.layerSchemaErrorTransform(
		SearchFileSchemaErrors,
		asInvalidRequest(SearchFile),
	),
);

const FilesHandlers = HttpApiBuilder.group(
	BffApi,
	"files",
	Effect.fn(function* (handlers) {
		const readFile = yield* ReadFileBff;
		const searchFile = yield* SearchFileBff;
		const customCat = yield* CustomCatCli;
		const customWc = yield* CustomWcCli;
		return handlers.handleAll({
			ReadFile: ({ params }) =>
				readFile
					.run(params)
					.pipe(Effect.map(({ contents }) => contents)),
			SearchFile: ({ payload }) => searchFile.run(payload),
			CustomCat: ({ payload }) => customCat.run(payload),
			CustomWc: ({ payload }) => customWc.run(payload),
		});
	}),
);

export const RestRoutes = HttpApiBuilder.layer(BffApi).pipe(
	Layer.provide(FilesHandlers),
	Layer.provide(SchemaErrors),
);
