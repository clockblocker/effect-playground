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

// Each level owns its segment of the path: the API /api, the group /files,
// and each endpoint its own, so ReadFile serves GET /api/files/read/:name.
class FilesGroup extends HttpApiGroup.make("files")
	.add(
		HttpApiEndpoint.get("ReadFile", "/read/:name", {
			params: ReadFile.RequestShape.fields,
			success: Schema.String.pipe(HttpApiSchema.asText()),
			error: errorsOf(ReadFile.Failure),
		}),
		HttpApiEndpoint.post("SearchFile", "/search", {
			payload: SearchFile.RequestShape,
			success: SearchFile.Success,
			error: errorsOf(SearchFile.Failure),
		}).middleware(SearchFileSchemaErrors),
		HttpApiEndpoint.post("CustomCat", "/copy", {
			payload: CustomCat.RequestShape,
			success: CustomCat.Success,
			error: errorsOf(CustomCat.Failure, CliFailed),
		}).middleware(CustomCatSchemaErrors),
		HttpApiEndpoint.post("CustomWc", "/count", {
			payload: CustomWc.RequestShape,
			success: CustomWc.Success,
			error: errorsOf(CustomWc.Failure, CliFailed),
		}).middleware(CustomWcSchemaErrors),
	)
	.prefix("/files") {}

// prefix applies to the groups added before it.
export class BffApi extends HttpApi.make("bff")
	.add(FilesGroup)
	.prefix("/api")
	.annotate(HttpApi.ParseOptions, {
		errors: "all",
		onExcessProperty: "error", // turn unknown field into errors
	}) {}
