import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from "effect/http-api";
import { ReadFile } from "./generated/reader-protocol.ts";
import { ReaderUnavailable } from "./reader-unavailable.ts";

// One endpoint per reader, so each declares only the errors it can return:
// GET /api/bun/files/:name → 200 text/plain, 415 NotTxtFile, 404 FileNotFound;
// GET /api/cpp/files/:name → the same, plus 503 ReaderUnavailable. The
// statuses are attached here, because the errors are shared with RPC and the
// C++ protocol, and only this transport reads them.
const readFileErrors = [
	ReadFile.NotTxtFile.pipe(HttpApiSchema.status(415)),
	ReadFile.FileNotFound.pipe(HttpApiSchema.status(404)),
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
					ReaderUnavailable.pipe(HttpApiSchema.status(503)),
				],
			}),
		)
		.prefix("/api"),
) {}
