import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { BffApi } from "../shared/rest-api.ts";
import { BackendReader } from "./backend-reader.ts";
import { BffReader } from "./bff-reader.ts";

const BffHandlers = HttpApiBuilder.group(
	BffApi,
	"bff",
	Effect.fn(function* (handlers) {
		const bff = yield* BffReader;
		return handlers.handle("read", ({ params }) =>
			bff.read(params.name).pipe(Effect.map(({ contents }) => contents)),
		);
	}),
);

const BackendHandlers = HttpApiBuilder.group(
	BffApi,
	"backend",
	Effect.fn(function* (handlers) {
		const backend = yield* BackendReader;
		return handlers.handle("read", ({ params }) =>
			backend
				.read(params.name)
				.pipe(Effect.map(({ contents }) => contents)),
		);
	}),
);

export const RestRoutes = HttpApiBuilder.layer(BffApi).pipe(
	Layer.provide([BffHandlers, BackendHandlers]),
);
