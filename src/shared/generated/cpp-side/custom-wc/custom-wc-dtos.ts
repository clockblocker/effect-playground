/*
Generated
- from: cpp/include/protocol/custom_wc.hpp
- by: scripts/generate.ts
*/

import { Schema } from "effect";

export const Request = Schema.Struct({
	file: Schema.String.check(
		Schema.isMinCodePoints(5),
		Schema.isMaxCodePoints(25),
		Schema.isPattern(/^(?!\.\.?$)[^/\\]*$/u),
		Schema.isPattern(/^.+\.txt$/u),
	),
});

export const Success = Schema.Struct({
	lines: Schema.Int,
	words: Schema.Int,
	bytes: Schema.Int,
});

export class IoFailed extends Schema.TaggedError<IoFailed>()("IoFailed", {
	message: Schema.String,
}) {}

export const Errors = [IoFailed] as const;
