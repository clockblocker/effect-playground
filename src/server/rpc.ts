import { Effect, Layer } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { BffRpcs } from "../shared/rpc.ts";
import { BackendReader } from "./backend-reader.ts";
import { BffReader } from "./bff-reader.ts";

const BffRpcHandlers = BffRpcs.toLayer(
	Effect.gen(function* () {
		const bff = yield* BffReader;
		const backend = yield* BackendReader;
		return BffRpcs.of({
			ReadFileBff: ({ name }) => bff.read(name),
			ReadFileBackend: ({ name }) => backend.read(name),
		});
	}),
);

export const RpcRoutes = RpcServer.layerHttp({
	group: BffRpcs,
	path: "/rpc",
	protocol: "http",
}).pipe(Layer.provide([BffRpcHandlers, RpcSerialization.layerJson]));
