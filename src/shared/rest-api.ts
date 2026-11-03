import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiMiddleware,
	HttpApiSchema,
} from "effect/http-api";
import { CliFailed } from "./cli-failed.ts";
import { CustomCat, IoFailed, ReadFile } from "./generated/protocol.ts";

// HttpApiSchema.status keeps what a schema decodes to and from, but Effect
// types the annotated schema by its internals (decodeTo<declareConstructor…>),
// so hovers turn unreadable. This names just what is kept.
const withStatus =
	(code: number) =>
	<S extends Schema.Top>(
		self: S,
	): Schema.Codec<
		S["Type"],
		S["Encoded"],
		S["DecodingServices"],
		S["EncodingServices"]
	> =>
		self.pipe(HttpApiSchema.status(code));

// The generated field, so a name the protocol rejects (too short, too long,
// a path) never reaches a handler.
const params = { name: ReadFile.Request.fields.name };

const readFileInvalid = ReadFile.InvalidRequest.pipe(withStatus(422));
const customCatInvalid = CustomCat.InvalidRequest.pipe(withStatus(422));

// The BFF's own disk failed: its fault, not the client's.
const ioFailed = IoFailed.pipe(withStatus(500));

/**
 * Turns a request the schema rejects, of the wrong shape or for a rule such
 * as a name too short, into the method's InvalidRequest, as the handler or
 * custom_cat would have.
 */
export class ReadFileSchemaErrors extends HttpApiMiddleware.Service<ReadFileSchemaErrors>()(
	"effect-playground/ReadFileSchemaErrors",
	{ error: readFileInvalid },
) {}

/** As ReadFileSchemaErrors, for a copy. */
export class CustomCatSchemaErrors extends HttpApiMiddleware.Service<CustomCatSchemaErrors>()(
	"effect-playground/CustomCatSchemaErrors",
	{ error: customCatInvalid },
) {}

export class BffApi extends HttpApi.make("bff")
	.add(
		HttpApiGroup.make("files")
			.add(
				HttpApiEndpoint.get("read", "/files/read/:name", {
					params,
					success: Schema.String.pipe(HttpApiSchema.asText()),
					error: [readFileInvalid, ioFailed],
				}).middleware(ReadFileSchemaErrors),
				HttpApiEndpoint.post("copy", "/files/copy", {
					payload: CustomCat.Request,
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
