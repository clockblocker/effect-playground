import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { FilesApi } from "../shared/rest-api.ts";
import { BunReader } from "./bun-reader.ts";
import { CppReader } from "./cpp-reader.ts";

const BunHandlers = HttpApiBuilder.group(
	FilesApi,
	"bun",
	Effect.fn(function* (handlers) {
		const bun = yield* BunReader;
		return handlers.handle("read", ({ params }) =>
			bun.read(params.name).pipe(Effect.map(({ contents }) => contents)),
		);
	}),
);

const CppHandlers = HttpApiBuilder.group(
	FilesApi,
	"cpp",
	Effect.fn(function* (handlers) {
		const cpp = yield* CppReader;
		return handlers.handle("read", ({ params }) =>
			cpp.read(params.name).pipe(Effect.map(({ contents }) => contents)),
		);
	}),
);

export const RestRoutes = HttpApiBuilder.layer(FilesApi).pipe(
	Layer.provide([BunHandlers, CppHandlers]),
);
