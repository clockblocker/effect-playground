import { Duration, Match, Schema } from "effect";

const Reason = Schema.Union([
	Schema.TaggedStruct("NotFound", {}),
	Schema.TaggedStruct("NotExecutable", {}),
	Schema.TaggedStruct("NotStarted", { error: Schema.String }),
	Schema.TaggedStruct("Killed", { signal: Schema.String }),
	Schema.TaggedStruct("TimedOut", { millis: Schema.Number }),
]);

/**
 * The BFF couldn't run custom_cat to its end. Declared here, not in the C++
 * protocol, because only the BFF sees it: custom_cat never ran, or never
 * finished.
 */
export class CliFailed extends Schema.TaggedError<CliFailed>()("CliFailed", {
	reason: Reason,
}) {
	override get message(): string {
		return Match.valueTags(this.reason, {
			NotFound: () => "custom_cat can't be found",
			NotExecutable: () => "custom_cat isn't executable",
			NotStarted: ({ error }) => `custom_cat didn't start: ${error}`,
			Killed: ({ signal }) => `custom_cat was killed by ${signal}`,
			TimedOut: ({ millis }) =>
				`custom_cat didn't finish within ${Duration.format(Duration.millis(millis))}`,
		});
	}
}
