import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { FilesApi } from "../shared/rest-api.ts";
import { BunReader } from "./bun-reader.ts";
import { CppReader } from "./cpp-reader.ts";

const FilesHandlers = HttpApiBuilder.group(
	FilesApi,
	"files",
	Effect.fn(function* (handlers) {
		const bun = yield* BunReader;
		const cpp = yield* CppReader;
		return handlers
			.handle("bun", ({ params }) =>
				bun
					.read(params.name)
					.pipe(Effect.map(({ contents }) => contents)),
			)
			.handle("cpp", ({ params }) =>
				cpp
					.read(params.name)
					.pipe(Effect.map(({ contents }) => contents)),
			);
	}),
);

export const RestRoutes = HttpApiBuilder.layer(FilesApi).pipe(
	Layer.provide(FilesHandlers),
);
