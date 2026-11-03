// Type-level checks, run by `bun run check` (tsc), not by `bun test`: only
// the backend reads can fail with BackendUnavailable, through the page's RPC
// mutations and through a client of the REST API, which other clients use.
import type { Effect } from "effect";
import type { HttpApiClient } from "effect/http-api";
import type { AsyncResult, Atom } from "effect/reactivity";
import type { reads } from "../src/client/read-file.ts";
import type { BackendUnavailable } from "../src/shared/backend-unavailable.ts";
import type { BffApi } from "../src/shared/rest-api.ts";

type Includes<Errors, E> = [Extract<Errors, E>] extends [never] ? false : true;

// A REST call returns an Effect; a page read is a mutation atom whose value is
// an AsyncResult. Either way, check its error channel.
type FailsWith<Read, E> = Read extends (
	...args: never[]
) => Effect.Effect<unknown, infer Errors, unknown>
	? Includes<Errors, E>
	: Read extends Atom.Atom<AsyncResult.AsyncResult<unknown, infer Errors>>
		? Includes<Errors, E>
		: "neither a call that returns an Effect nor an AsyncResult atom";

type Expect<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;

type RestClient = HttpApiClient.ForApi<typeof BffApi>;

export type Checks = [
	Expect<Not<FailsWith<typeof reads.bff, BackendUnavailable>>>,
	Expect<FailsWith<typeof reads.backend, BackendUnavailable>>,
	Expect<Not<FailsWith<RestClient["bff"]["read"], BackendUnavailable>>>,
	Expect<FailsWith<RestClient["backend"]["read"], BackendUnavailable>>,
];
