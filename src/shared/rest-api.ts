import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from "effect/http-api";
import { BackendUnavailable } from "./backend-unavailable.ts";
import { ReadFile } from "./generated/backend-protocol.ts";

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
// bff.read and backend.read and each declares only its own errors:
// GET /api/bff/files/read/:name → 200 text/plain, 415 NotTxtFile, 404 FileNotFound;
// GET /api/backend/files/read/:name → the same, plus 503 BackendUnavailable.
// The statuses are attached here, because the errors are shared with RPC and
// the backend protocol, and only this transport reads them.
const readFileErrors = [
	ReadFile.NotTxtFile.pipe(withStatus(415)),
	ReadFile.FileNotFound.pipe(withStatus(404)),
] as const;

// The generated field, so a name the backend protocol rejects (too short, too
// long) never reaches a handler: HttpApi answers 400 itself.
const params = { name: ReadFile.Request.fields.name };
const success = Schema.String.pipe(HttpApiSchema.asText());

export class BffApi extends HttpApi.make("bff")
	.add(
		HttpApiGroup.make("bff")
			.add(
				HttpApiEndpoint.get("read", "/files/read/:name", {
					params,
					success,
					error: readFileErrors,
				}),
			)
			.prefix("/api/bff"),
	)
	.add(
		HttpApiGroup.make("backend")
			.add(
				HttpApiEndpoint.get("read", "/files/read/:name", {
					params,
					success,
					error: [
						...readFileErrors,
						BackendUnavailable.pipe(withStatus(503)),
					],
				}),
			)
			.prefix("/api/backend"),
	) {}
