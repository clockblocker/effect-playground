import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from "effect/http-api";
import { ReadFile } from "./generated/reader-protocol.ts";
import { ReaderUnavailable } from "./reader-unavailable.ts";

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

// One endpoint per reader, so each declares only the errors it can return:
// GET /api/bun/files/:name → 200 text/plain, 415 NotTxtFile, 404 FileNotFound;
// GET /api/cpp/files/:name → the same, plus 503 ReaderUnavailable. The
// statuses are attached here, because the errors are shared with RPC and the
// C++ protocol, and only this transport reads them.
const readFileErrors = [
	ReadFile.NotTxtFile.pipe(withStatus(415)),
	ReadFile.FileNotFound.pipe(withStatus(404)),
] as const;

// The generated field, so a name the C++ protocol rejects (too short, too
// long) never reaches a handler: HttpApi answers 400 itself.
const params = { name: ReadFile.Request.fields.name };
const success = Schema.String.pipe(HttpApiSchema.asText());

export class FilesApi extends HttpApi.make("files-api").add(
	HttpApiGroup.make("files")
		.add(
			HttpApiEndpoint.get("bun", "/bun/files/:name", {
				params,
				success,
				error: readFileErrors,
			}),
			HttpApiEndpoint.get("cpp", "/cpp/files/:name", {
				params,
				success,
				error: [
					...readFileErrors,
					ReaderUnavailable.pipe(withStatus(503)),
				],
			}),
		)
		.prefix("/api"),
) {}
