import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { ReadFileBff } from "./bun-side/read-file/read-file.ts";
import { SearchFileBff } from "./bun-side/search-file/search-file.ts";
import { CustomCatCli } from "./cpp-side/custom-cat.ts";
import { CustomWcCli } from "./cpp-side/custom-wc.ts";
import { McpRoutes } from "./protocols/mcp.ts";
import { RestRoutes } from "./protocols/rest.ts";
import { RpcRoutes } from "./protocols/rpc.ts";

const Routes = Layer.mergeAll(RestRoutes, RpcRoutes, McpRoutes).pipe(
	Layer.provide([SearchFileBff.layer, CustomCatCli.layer, CustomWcCli.layer]),
	Layer.provideMerge(ReadFileBff.layer),
);

const port = Number(process.env.EFFECT_PLAYGROUND_SERVER_PORT ?? 5201);

const Server = HttpRouter.serve(Routes).pipe(
	Layer.provide(BunHttpServer.layer({ port })),
);

Layer.launch(Server).pipe(BunRuntime.runMain);
