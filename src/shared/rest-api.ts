import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from "effect/http-api";
import { FileNotFound, NotTxtFile, ReaderUnavailable } from "./errors.ts";

// One endpoint per reader, so each declares only the errors it can return:
// GET /api/bun/files/:name → 200 text/plain, 415 NotTxtFile, 404 FileNotFound;
// GET /api/cpp/files/:name → the same, plus 503 ReaderUnavailable. The
// statuses are attached here, because the errors are shared with RPC and the
// C++ protocol, and only this transport reads them.
const readFileErrors = [
	NotTxtFile.pipe(HttpApiSchema.status(415)),
	FileNotFound.pipe(HttpApiSchema.status(404)),
] as const;

const params = { name: Schema.String };
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
