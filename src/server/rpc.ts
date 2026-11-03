import { Effect, Layer } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { BffRpcs } from "../shared/rpc.ts";
import { BffReader } from "./bff-reader.ts";

const BffRpcHandlers = BffRpcs.toLayer(
	Effect.gen(function* () {
		const reader = yield* BffReader;
		return BffRpcs.of({
			ReadFile: ({ name }) => reader.read(name),
		});
	}),
);

export const RpcRoutes = RpcServer.layerHttp({
	group: BffRpcs,
	path: "/rpc",
	protocol: "http",
}).pipe(Layer.provide([BffRpcHandlers, RpcSerialization.layerJson]));
