/*
Generated
- from: src/server/bun-side/search-file/search-file-dtos.ts
- by: scripts/generate.ts
*/

import { Schema } from "effect";

export const Request = Schema.Struct({
	name: Schema.String.check(
		Schema.isMinCodePoints(5),
		Schema.isMaxCodePoints(25),
		Schema.isPattern(/^(?!\.\.?$)[^/\\]*$/u),
		Schema.isPattern(/^.+\.txt$/u),
	),
	query: Schema.String.check(Schema.isMinLength(1)),
});

export const Success = Schema.Struct({
	matches: Schema.Array(
		Schema.Struct({ line: Schema.Int, text: Schema.String }),
	),
});

export class IoFailed extends Schema.TaggedError<IoFailed>()("IoFailed", {
	message: Schema.String,
}) {}

export const Errors = [IoFailed] as const;
