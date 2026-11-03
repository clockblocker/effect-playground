import { Effect, Layer } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { BffRpcs } from "../shared/rpc.ts";
import { BffReader } from "./bff-reader.ts";
import { CustomCatCli } from "./custom-cat.ts";

const BffRpcHandlers = BffRpcs.toLayer(
	Effect.gen(function* () {
		const reader = yield* BffReader;
		const cli = yield* CustomCatCli;
		return BffRpcs.of({
			ReadFile: ({ name }) => reader.read(name),
			CustomCat: (request) => cli.run(request),
		});
	}),
);

export const RpcRoutes = RpcServer.layerHttp({
	group: BffRpcs,
	path: "/rpc",
	protocol: "http",
}).pipe(Layer.provide([BffRpcHandlers, RpcSerialization.layerJson]));
