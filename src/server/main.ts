import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { BffReader } from "./bff-reader.ts";
import { CustomCatCli } from "./custom-cat.ts";
import { McpRoutes } from "./mcp.ts";
import { RestRoutes } from "./rest.ts";
import { RpcRoutes } from "./rpc.ts";

const Routes = Layer.mergeAll(RestRoutes, RpcRoutes, McpRoutes).pipe(
	Layer.provide([BffReader.layer, CustomCatCli.layer]),
);

const port = Number(process.env.EFFECT_PLAYGROUND_SERVER_PORT ?? 5201);

const Server = HttpRouter.serve(Routes).pipe(
	Layer.provide(BunHttpServer.layer({ port })),
);

Layer.launch(Server).pipe(BunRuntime.runMain);
