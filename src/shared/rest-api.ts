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

// One group per reader, each with a read endpoint, so the client reads
// files.bun.read and files.cpp.read and each declares only its own errors:
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

export class FilesApi extends HttpApi.make("files")
	.add(
		HttpApiGroup.make("bun")
			.add(
				HttpApiEndpoint.get("read", "/files/:name", {
					params,
					success,
					error: readFileErrors,
				}),
			)
			.prefix("/api/bun"),
	)
	.add(
		HttpApiGroup.make("cpp")
			.add(
				HttpApiEndpoint.get("read", "/files/:name", {
					params,
					success,
					error: [
						...readFileErrors,
						ReaderUnavailable.pipe(withStatus(503)),
					],
				}),
			)
			.prefix("/api/cpp"),
	) {}
