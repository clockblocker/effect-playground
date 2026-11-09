// What SearchFile takes, succeeds with and fails with. The BFF serves it
// itself, in BffSearcher (search-file.ts). `bun run generate` writes them
// again, and SearchFile's namespace, in
// src/shared/generated/bun-side/search-file/.

import { Schema } from "effect";

export const Request = Schema.Struct({
	// A name in files/, with the rules ReadFile's has.
	name: Schema.String.check(
		Schema.isMinCodePoints(5),
		Schema.isMaxCodePoints(25),
		Schema.isPattern(/^(?!\.\.?$)[^/\\]*$/u),
		Schema.isPattern(/^.+\.txt$/u),
	),
	// What a line must contain, as it is: no pattern, no case folding.
	query: Schema.String.check(Schema.isMinLength(1)),
});

export const Success = Schema.Struct({
	// Every line that contains the query, in order, numbered from 1.
	matches: Schema.Array(
		Schema.Struct({ line: Schema.Int, text: Schema.String }),
	),
});

// The BFF's own disk failed, as ReadFile's IoFailed says.
export class IoFailed extends Schema.TaggedError<IoFailed>()("IoFailed", {
	message: Schema.String,
}) {}

export const Errors = [IoFailed] as const;
