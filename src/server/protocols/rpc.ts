import { Cause, Effect, Layer } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { BffRpcs } from "../../shared/rpc.ts";
import { ReadFileBff } from "../bun-side/read-file/read-file.ts";
import { SearchFileBff } from "../bun-side/search-file/search-file.ts";
import { CustomCatCli } from "../cpp-side/custom-cat.ts";
import { CustomWcCli } from "../cpp-side/custom-wc.ts";

// RpcServer sends a defect to the client without logging it.
const logDefects = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.tapCause((cause) =>
			Cause.hasDies(cause) ? Effect.logError(cause) : Effect.void,
		),
	);

const BffRpcHandlers = BffRpcs.toLayer(
	Effect.gen(function* () {
		const readFile = yield* ReadFileBff;
		const searchFile = yield* SearchFileBff;
		const customCat = yield* CustomCatCli;
		const customWc = yield* CustomWcCli;
		return BffRpcs.of({
			ReadFile: (request) => logDefects(readFile.run(request)),
			SearchFile: (request) => logDefects(searchFile.run(request)),
			CustomCat: (request) => logDefects(customCat.run(request)),
			CustomWc: (request) => logDefects(customWc.run(request)),
		});
	}),
);

export const RpcRoutes = RpcServer.layerHttp({
	group: BffRpcs,
	path: "/rpc",
	protocol: "http",
}).pipe(Layer.provide([BffRpcHandlers, RpcSerialization.layerJson]));
