import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { BffApi } from "../shared/rest-api.ts";
import { BffReader } from "./bff-reader.ts";
import { CustomCatCli } from "./custom-cat.ts";

const FilesHandlers = HttpApiBuilder.group(
	BffApi,
	"files",
	Effect.fn(function* (handlers) {
		const reader = yield* BffReader;
		const cli = yield* CustomCatCli;
		return handlers
			.handle("read", ({ params }) =>
				reader
					.read(params.name)
					.pipe(Effect.map(({ contents }) => contents)),
			)
			.handle("copy", ({ payload }) => cli.run(payload));
	}),
);

export const RestRoutes = HttpApiBuilder.layer(BffApi).pipe(
	Layer.provide(FilesHandlers),
);
