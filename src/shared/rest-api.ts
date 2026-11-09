import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from "effect/http-api";
import {
	CustomCat,
	CustomWc,
	ReadFile,
	SearchFile,
} from "./generated/generated.ts";
import { errorsOf, SchemaErrorsOf } from "./helpers/rest-errors.ts";
import { CliFailed } from "./helpers/tagged-errors.ts";

export class CustomCatSchemaErrors extends SchemaErrorsOf<CustomCatSchemaErrors>()(
	"effect-playground/CustomCatSchemaErrors",
	CustomCat,
) {}

export class CustomWcSchemaErrors extends SchemaErrorsOf<CustomWcSchemaErrors>()(
	"effect-playground/CustomWcSchemaErrors",
	CustomWc,
) {}

export class SearchFileSchemaErrors extends SchemaErrorsOf<SearchFileSchemaErrors>()(
	"effect-playground/SearchFileSchemaErrors",
	SearchFile,
) {}

export class BffApi extends HttpApi.make("bff")
	.add(
		HttpApiGroup.make("files")
			.add(
				HttpApiEndpoint.get("read", "/files/read/:name", {
					params: ReadFile.RequestShape.fields,
					success: Schema.String.pipe(HttpApiSchema.asText()),
					error: errorsOf(ReadFile.Failure),
				}),
				HttpApiEndpoint.post("search", "/files/search", {
					payload: SearchFile.RequestShape,
					success: SearchFile.Success,
					error: errorsOf(SearchFile.Failure),
				}).middleware(SearchFileSchemaErrors),
				HttpApiEndpoint.post("copy", "/files/copy", {
					payload: CustomCat.RequestShape,
					success: CustomCat.Success,
					error: errorsOf(CustomCat.Failure, CliFailed),
				}).middleware(CustomCatSchemaErrors),
				HttpApiEndpoint.post("count", "/files/count", {
					payload: CustomWc.RequestShape,
					success: CustomWc.Success,
					error: errorsOf(CustomWc.Failure, CliFailed),
				}).middleware(CustomWcSchemaErrors),
			)
			.prefix("/api"),
	)
	.annotate(HttpApi.ParseOptions, {
		errors: "all",
		onExcessProperty: "error", // turn unknown field into errors
	}) {}
