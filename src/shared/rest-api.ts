import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiMiddleware,
	HttpApiSchema,
} from "effect/http-api";
import { CustomCat, CustomWc, ReadFile } from "./generated/generated.ts";
import { CliFailed } from "./helpers/cli-failed.ts";
import { withStatus } from "./helpers/with-status.ts";

const readFileInvalid = ReadFile.InvalidRequest.pipe(withStatus(422));
const customCatInvalid = CustomCat.InvalidRequest.pipe(withStatus(422));
const customWcInvalid = CustomWc.InvalidRequest.pipe(withStatus(422));

// The disk failed, the BFF's or custom_cat's: their fault, not the client's.
const readFileIoFailed = ReadFile.IoFailed.pipe(withStatus(500));
const customCatIoFailed = CustomCat.IoFailed.pipe(withStatus(500));
const customWcIoFailed = CustomWc.IoFailed.pipe(withStatus(500));

// A C++ operation is a service the BFF depends on, like a backend.
const cliFailed = CliFailed.pipe(withStatus(503));

/**
 * Turns a body of the wrong shape, which no handler sees, into the method's
 * InvalidRequest. The body is decoded by its shape alone, so custom_cat
 * checks the rules.
 */
export class CustomCatSchemaErrors extends HttpApiMiddleware.Service<CustomCatSchemaErrors>()(
	"effect-playground/CustomCatSchemaErrors",
	{ error: customCatInvalid },
) {}

/** As CustomCatSchemaErrors, for custom_wc. */
export class CustomWcSchemaErrors extends HttpApiMiddleware.Service<CustomWcSchemaErrors>()(
	"effect-playground/CustomWcSchemaErrors",
	{ error: customWcInvalid },
) {}

export class BffApi extends HttpApi.make("bff")
	.add(
		HttpApiGroup.make("files")
			.add(
				// BffReader checks the name's rules.
				HttpApiEndpoint.get("read", "/files/read/:name", {
					params: ReadFile.RequestShape.fields,
					success: Schema.String.pipe(HttpApiSchema.asText()),
					error: [readFileInvalid, readFileIoFailed],
				}),
				HttpApiEndpoint.post("copy", "/files/copy", {
					payload: CustomCat.RequestShape,
					success: CustomCat.Success,
					error: [customCatInvalid, customCatIoFailed, cliFailed],
				}).middleware(CustomCatSchemaErrors),
				HttpApiEndpoint.post("count", "/files/count", {
					payload: CustomWc.RequestShape,
					success: CustomWc.Success,
					error: [customWcInvalid, customWcIoFailed, cliFailed],
				}).middleware(CustomWcSchemaErrors),
			)
			.prefix("/api"),
	)
	// Every issue, as custom_cat reports them, and an unknown field is wrong,
	// as custom_cat's unknown flag is.
	.annotate(HttpApi.ParseOptions, {
		errors: "all",
		onExcessProperty: "error",
	}) {}
