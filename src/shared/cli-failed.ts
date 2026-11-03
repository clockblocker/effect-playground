import { Schema } from "effect";

/**
 * The BFF couldn't run custom_cat to its end. Declared here, not in the C++
 * protocol, because only the BFF sees it: custom_cat never ran, or never
 * finished.
 */
export class CliFailed extends Schema.TaggedError<CliFailed>()("CliFailed", {
	message: Schema.String,
}) {}
