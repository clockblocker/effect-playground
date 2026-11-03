import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
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

// The generated field, so a name the protocol rejects (too short, too long)
// never reaches a handler: HttpApi answers 400 itself.
const params = { name: ReadFile.Request.fields.name };

// The BFF's own disk failed: its fault, not the client's.
const ioFailed = IoFailed.pipe(withStatus(500));

export class BffApi extends HttpApi.make("bff").add(
	HttpApiGroup.make("files")
		.add(
			HttpApiEndpoint.get("read", "/files/read/:name", {
				params,
				success: Schema.String.pipe(HttpApiSchema.asText()),
				error: [
					ReadFile.InvalidRequest.pipe(withStatus(422)),
					ioFailed,
				],
			}),
			HttpApiEndpoint.post("copy", "/files/copy", {
				payload: CustomCat.Request,
				success: CustomCat.Success,
				error: [
					CustomCat.InvalidRequest.pipe(withStatus(422)),
					ioFailed,
					// custom_cat is a service the BFF depends on, like a backend.
					CliFailed.pipe(withStatus(503)),
				],
			}),
		)
		.prefix("/api"),
) {}
