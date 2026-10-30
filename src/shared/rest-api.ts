import { Schema } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from "effect/http-api";
import { FileNotFound, NotTxtFile } from "./errors.ts";

// GET /api/files/:name → 200 text/plain, 415 NotTxtFile, 404 FileNotFound.
// The statuses are attached here, because the errors are shared with RPC and
// the C++ protocol, and only this transport reads them.
export class FilesApi extends HttpApi.make("files-api").add(
	HttpApiGroup.make("files")
		.add(
			HttpApiEndpoint.get("read", "/files/:name", {
				params: { name: Schema.String },
				success: Schema.String.pipe(HttpApiSchema.asText()),
				error: [
					NotTxtFile.pipe(HttpApiSchema.status(415)),
					FileNotFound.pipe(HttpApiSchema.status(404)),
				],
			}),
		)
		.prefix("/api"),
) {}
