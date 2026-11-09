// The BFF's own errors that cross the wire, beside every operation's, and
// what each hop adds to an operation's failure on its way to the page:
//
// - core, the C++ executable or the BFF's own code: `Op.Failure`, generated,
//   such as CustomCat.Failure, its InvalidRequest or IoFailed;
// - the BFF, when it runs a C++ operation: `CppSideFailure`, adding CliFailed;
// - the page, over RPC: `PageFailure`, in src/client/data-access, adding the
//   transport's RpcClientError.

import { Schema } from "effect";

/** The BFF failed to run a C++ operation's executable to its end. */
export class CliFailed extends Schema.TaggedError<CliFailed>()("CliFailed", {
	message: Schema.String,
}) {}

/** A C++ operation's failure, as the BFF answers it. */
export type CppSideFailure<F> = F | CliFailed;

/** A C++ operation's failure, as the BFF answers it: its own errors, then CliFailed. */
export const cppSideFailure = <const Members extends ReadonlyArray<Schema.Top>>(
	failure: Schema.Union<Members>,
) => Schema.Union([...failure.members, CliFailed]);
