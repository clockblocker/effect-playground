import { Schema } from "effect";

export class CliFailed extends Schema.TaggedError<CliFailed>()("CliFailed", {
	message: Schema.String,
}) {}
