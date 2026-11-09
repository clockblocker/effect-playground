// The BFF's own errors that cross the wire, beside every operation's, and
// what each hop adds to an operation's failure on its way to the page:
//
// - core, the C++ core or the BFF's own code: `Op.Failure`, generated, such
//   as CustomCat.Failure, its InvalidRequest or IoFailed;
// - the BFF, when it calls the C++ core: `CppSideFailure`, adding
//   CoreUnavailable;
// - the page, over RPC: `PageFailure`, in src/client/data-access, adding the
//   transport's RpcClientError.

import { Schema } from "effect";

/** The BFF couldn't get an answer from the C++ core. */
export class CoreUnavailable extends Schema.TaggedError<CoreUnavailable>()(
	"CoreUnavailable",
	{ message: Schema.String },
) {}

/** A C++ operation's failure, as the BFF answers it. */
export type CppSideFailure<F> = F | CoreUnavailable;

/** A C++ operation's failure, as the BFF answers it: its own errors, then CoreUnavailable. */
export const cppSideFailure = <const Members extends ReadonlyArray<Schema.Top>>(
	failure: Schema.Union<Members>,
) => Schema.Union([...failure.members, CoreUnavailable]);
