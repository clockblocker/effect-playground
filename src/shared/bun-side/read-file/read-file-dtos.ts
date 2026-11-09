// What ReadFile takes, succeeds with and fails with. The BFF serves it
// itself, in BffReader; `bun run generate` writes its namespace from this.

import { Schema } from "effect";

export const Request = Schema.Struct({
	// A name in files/, with the rules custom_cat's names have.
	name: Schema.String.check(
		Schema.isMinCodePoints(5),
		Schema.isMaxCodePoints(25),
		Schema.isPattern(/^(?!\.\.?$)[^/\\]*$/u),
		Schema.isPattern(/^.+\.txt$/u),
	),
});

export const Success = Schema.Struct({
	contents: Schema.String,
});

// The BFF's own disk failed, as custom_cat's IoFailed says of its own.
export class IoFailed extends Schema.TaggedError<IoFailed>()("IoFailed", {
	message: Schema.String,
}) {}

export const Errors = [IoFailed] as const;
