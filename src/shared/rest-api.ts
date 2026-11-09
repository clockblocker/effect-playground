import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiMiddleware,
	HttpApiSchema,
} from "effect/http-api";
import { CustomCat, IoFailed } from "./generated/protocol.ts";
import { CliFailed } from "./helpers/cli-failed.ts";
import { withStatus } from "./helpers/with-status.ts";
import { ReadFile } from "./read-file.ts";

const readFileInvalid = ReadFile.InvalidRequest.pipe(withStatus(422));
const customCatInvalid = CustomCat.InvalidRequest.pipe(withStatus(422));

// The BFF's own disk failed: its fault, not the client's.
const ioFailed = IoFailed.pipe(withStatus(500));

/**
 * Turns a body of the wrong shape, which no handler sees, into the method's
 * InvalidRequest. The body is decoded by its shape alone, so custom_cat
 * checks the rules.
 */
export class CustomCatSchemaErrors extends HttpApiMiddleware.Service<CustomCatSchemaErrors>()(
	"effect-playground/CustomCatSchemaErrors",
	{ error: customCatInvalid },
) {}

export class BffApi extends HttpApi.make("bff")
	.add(
		HttpApiGroup.make("files")
			.add(
				// BffReader checks the name's rules.
				HttpApiEndpoint.get("read", "/files/read/:name", {
					params: ReadFile.RequestShape.fields,
					success: Schema.String.pipe(HttpApiSchema.asText()),
					error: [readFileInvalid, ioFailed],
				}),
				HttpApiEndpoint.post("copy", "/files/copy", {
					payload: CustomCat.RequestShape,
					success: CustomCat.Success,
					error: [
						customCatInvalid,
						ioFailed,
						// custom_cat is a service the BFF depends on, like a backend.
						CliFailed.pipe(withStatus(503)),
					],
				}).middleware(CustomCatSchemaErrors),
			)
			.prefix("/api"),
	)
	// Every issue, as custom_cat reports them, and an unknown field is wrong,
	// as custom_cat's unknown flag is.
	.annotate(HttpApi.ParseOptions, {
		errors: "all",
		onExcessProperty: "error",
	}) {}
