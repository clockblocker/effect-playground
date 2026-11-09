import { Effect, Layer, Schema, SchemaIssue } from "effect";
import {
	HttpApiBuilder,
	type HttpApiError,
	HttpApiMiddleware,
} from "effect/http-api";
import { CustomCat, CustomWc } from "../../shared/generated/generated.ts";
import {
	BffApi,
	CustomCatSchemaErrors,
	CustomWcSchemaErrors,
} from "../../shared/rest-api.ts";
import { BffReader } from "../bun-side/bff-reader.ts";
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
);

const FilesHandlers = HttpApiBuilder.group(
	BffApi,
	"files",
	Effect.fn(function* (handlers) {
		const reader = yield* BffReader;
		const cat = yield* CustomCatCli;
		const wc = yield* CustomWcCli;
		return handlers
			.handle("read", ({ params }) =>
				reader
					.read(params.name)
					.pipe(Effect.map(({ contents }) => contents)),
			)
			.handle("copy", ({ payload }) => cat.run(payload))
			.handle("count", ({ payload }) => wc.run(payload));
	}),
);

export const RestRoutes = HttpApiBuilder.layer(BffApi).pipe(
	Layer.provide(FilesHandlers),
	Layer.provide(SchemaErrors),
);
