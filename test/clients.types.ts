// Type-level checks, run by `bun run check` (tsc), not by `bun test`: only
// the C++ calls can fail with ReaderUnavailable, over REST and over RPC.
import type { Effect } from "effect";
import type { rest, rpc } from "../src/client/read-file.ts";
import type { ReaderUnavailable } from "../src/shared/reader-unavailable.ts";

type FailsWith<Call, E> = Call extends (
	...args: never[]
) => Effect.Effect<unknown, infer Errors, unknown>
	? [Extract<Errors, E>] extends [never]
		? false
		: true
	: "not a call that returns an Effect";

type Expect<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;

export type Checks = [
	Expect<Not<FailsWith<typeof rest.bun, ReaderUnavailable>>>,
	Expect<FailsWith<typeof rest.cpp, ReaderUnavailable>>,
	Expect<Not<FailsWith<typeof rpc.bun, ReaderUnavailable>>>,
	Expect<FailsWith<typeof rpc.cpp, ReaderUnavailable>>,
];
