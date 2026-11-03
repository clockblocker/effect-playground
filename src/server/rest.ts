import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { BffApi } from "../shared/rest-api.ts";
import { BffReader } from "./bff-reader.ts";

const FilesHandlers = HttpApiBuilder.group(
	BffApi,
	"files",
	Effect.fn(function* (handlers) {
		const reader = yield* BffReader;
		return handlers.handle("read", ({ params }) =>
			reader
				.read(params.name)
				.pipe(Effect.map(({ contents }) => contents)),
		);
	}),
);

export const RestRoutes = HttpApiBuilder.layer(BffApi).pipe(
	Layer.provide(FilesHandlers),
);
