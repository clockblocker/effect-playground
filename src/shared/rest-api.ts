import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from "effect/http-api";
import { ReadFile } from "./generated/protocol.ts";

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

// The generated field, so a name the protocol rejects (too short, too long)
// never reaches a handler: HttpApi answers 400 itself.
const params = { name: ReadFile.Request.fields.name };

export class BffApi extends HttpApi.make("bff").add(
	HttpApiGroup.make("files")
		.add(
			HttpApiEndpoint.get("read", "/files/read/:name", {
				params,
				success: Schema.String.pipe(HttpApiSchema.asText()),
				error: ReadFile.InvalidRequest.pipe(withStatus(422)),
			}),
		)
		.prefix("/api"),
) {}
