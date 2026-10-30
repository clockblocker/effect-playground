// Type-level checks, run by `bun run check` (tsc), not by `bun test`: only
// the C++ calls can fail with ReaderUnavailable, over REST and over RPC.
import type { Context, Effect } from "effect";
import type { RestFiles, RpcFilesClient } from "../src/client/clients.ts";
import type { ReaderUnavailable } from "../src/shared/errors.ts";

type FailsWith<Call, E> = Call extends (
	...args: never[]
) => Effect.Effect<unknown, infer Errors, unknown>
	? [Extract<Errors, E>] extends [never]
		? false
		: true
	: "not a call that returns an Effect";

type Expect<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;

type Rest = Context.Service.Shape<typeof RestFiles>;
type Rpc = Context.Service.Shape<typeof RpcFilesClient>;

export type Checks = [
	Expect<Not<FailsWith<Rest["bun"], ReaderUnavailable>>>,
	Expect<FailsWith<Rest["cpp"], ReaderUnavailable>>,
	Expect<Not<FailsWith<Rpc["ReadFileBun"], ReaderUnavailable>>>,
	Expect<FailsWith<Rpc["ReadFileCpp"], ReaderUnavailable>>,
];
