/*
Generated
- from: src/server/bun-side/read-file/read-file-dtos.ts
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
});

export const Success = Schema.Struct({
	contents: Schema.String,
});

export class IoFailed extends Schema.TaggedError<IoFailed>()("IoFailed", {
	message: Schema.String,
}) {}

export const Errors = [IoFailed] as const;
