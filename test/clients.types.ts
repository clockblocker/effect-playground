// Type-level checks, run by `bun run check` (tsc), not by `bun test`: only
// the backend calls can fail with BackendUnavailable, over REST and over RPC.
import type { Effect } from "effect";
import type { rest, rpc } from "../src/client/read-file.ts";
import type { BackendUnavailable } from "../src/shared/backend-unavailable.ts";

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
	Expect<Not<FailsWith<typeof rest.bff, BackendUnavailable>>>,
	Expect<FailsWith<typeof rest.backend, BackendUnavailable>>,
	Expect<Not<FailsWith<typeof rpc.bff, BackendUnavailable>>>,
	Expect<FailsWith<typeof rpc.backend, BackendUnavailable>>,
];
