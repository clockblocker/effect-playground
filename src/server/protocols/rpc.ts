import { Cause, Effect, Layer } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { BffRpcs } from "../../shared/rpc.ts";
import { BffReader } from "../bun-side/bff-reader.ts";
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
		const reader = yield* BffReader;
		const cat = yield* CustomCatCli;
		const wc = yield* CustomWcCli;
		return BffRpcs.of({
			ReadFile: ({ name }) => logDefects(reader.read(name)),
			CustomCat: (request) => logDefects(cat.run(request)),
			CustomWc: (request) => logDefects(wc.run(request)),
		});
	}),
);

export const RpcRoutes = RpcServer.layerHttp({
	group: BffRpcs,
	path: "/rpc",
	protocol: "http",
}).pipe(Layer.provide([BffRpcHandlers, RpcSerialization.layerJson]));
