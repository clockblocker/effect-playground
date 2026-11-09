// The BFF's own errors that cross the wire, beside every operation's: an
// operation's errors are in its DTOs, such as CustomCat.IoFailed.

import { Schema } from "effect";

/** The BFF failed to run a C++ operation's executable to its end. */
export class CliFailed extends Schema.TaggedError<CliFailed>()("CliFailed", {
	message: Schema.String,
}) {}
