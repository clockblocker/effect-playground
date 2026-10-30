import { Effect, Layer } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { FilesRpcs } from "../shared/rpc.ts";
import { BunReader } from "./bun-reader.ts";
import { CppReader } from "./cpp-reader.ts";

const FilesHandlers = FilesRpcs.toLayer(
	Effect.gen(function* () {
		const bun = yield* BunReader;
		const cpp = yield* CppReader;
		return FilesRpcs.of({
			ReadFileBun: ({ name }) => bun.read(name),
			ReadFileCpp: ({ name }) => cpp.read(name),
		});
	}),
);

export const RpcRoutes = RpcServer.layerHttp({
	group: FilesRpcs,
	path: "/rpc",
	protocol: "http",
}).pipe(Layer.provide([FilesHandlers, RpcSerialization.layerJson]));
