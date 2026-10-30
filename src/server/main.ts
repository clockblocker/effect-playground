import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { BackendReader } from "./backend-reader.ts";
import { BffReader } from "./bff-reader.ts";
import { RestRoutes } from "./rest.ts";
import { RpcRoutes } from "./rpc.ts";

// Both transports mount on one router, over the same two readers: each
// endpoint and procedure names the reader it calls.
const Routes = Layer.mergeAll(RestRoutes, RpcRoutes).pipe(
	Layer.provide([BffReader.layer, BackendReader.layer]),
);

const port = Number(process.env.EFFECT_PLAYGROUND_SERVER_PORT ?? 5201);

const Server = HttpRouter.serve(Routes).pipe(
	Layer.provide(BunHttpServer.layer({ port })),
);

Layer.launch(Server).pipe(BunRuntime.runMain);
