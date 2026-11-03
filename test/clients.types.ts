// Type-level checks, run by `bun run check` (tsc), not by `bun test`: only
// the backend reads can fail with BackendUnavailable, through the page's RPC
// client and through a client of the REST API, which other clients use.
import type { Effect } from "effect";
import type { HttpApiClient } from "effect/http-api";
import type { readers } from "../src/client/read-file.ts";
import type { BackendUnavailable } from "../src/shared/backend-unavailable.ts";
import type { BffApi } from "../src/shared/rest-api.ts";

type FailsWith<Call, E> = Call extends (
	...args: never[]
) => Effect.Effect<unknown, infer Errors, unknown>
	? [Extract<Errors, E>] extends [never]
		? false
		: true
	: "not a call that returns an Effect";

type Expect<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;

type RestClient = HttpApiClient.ForApi<typeof BffApi>;

export type Checks = [
	Expect<Not<FailsWith<typeof readers.bff, BackendUnavailable>>>,
	Expect<FailsWith<typeof readers.backend, BackendUnavailable>>,
	Expect<Not<FailsWith<RestClient["bff"]["read"], BackendUnavailable>>>,
	Expect<FailsWith<RestClient["backend"]["read"], BackendUnavailable>>,
];
