// What every generated procedure's namespace builds the same way, from its
// own Path, Success and errors. scripts/protocol/emit.ts writes the calls.

import { type Cause, Schema } from "effect";

/** A problem with a request: what is wrong, and where. */
export const issueOf = <P extends Schema.Top>(path: P) =>
	Schema.Struct({ message: Schema.String, path });

type InvalidRequestSchema<I extends Schema.Top> = Schema.TaggedStruct<
	"InvalidRequest",
	{ readonly issues: Schema.NonEmptyArray<I> }
>;

/**
 * The base of a procedure's InvalidRequest, every problem with a request's
 * fields: `class InvalidRequest extends InvalidRequestOf<InvalidRequest>()(Issue) {}`.
 * Its message joins its issues'.
 */
export const InvalidRequestOf =
	<Self>() =>
	<I extends Schema.Top>(
		issue: I,
	): Schema.Class<Self, InvalidRequestSchema<I>, Cause.YieldableError> => {
		interface Issues {
			readonly issues: ReadonlyArray<{ readonly message: string }>;
		}
		// TaggedError<Self> stays a conditional type while Self is a type
		// parameter, so the class is typed by the return type instead.
		const Base = Schema.TaggedError<Issues>()("InvalidRequest", {
			issues: Schema.NonEmptyArray(issue),
		}) as unknown as new (
			...args: never[]
		) => Issues;
		class InvalidRequest extends Base {
			// A getter, not a field: the message never crosses the wire, and
			// every decoded instance still has it.
			get message(): string {
				return this.issues.map((issue) => issue.message).join("; ");
			}
		}
		return InvalidRequest as never;
	};

/** What a procedure fails with: its InvalidRequest, then its other errors. */
export const failureOf = <
	I extends Schema.Top,
	const E extends ReadonlyArray<Schema.Top>,
>(
	invalidRequest: I,
	errors: E,
) => Schema.Union([invalidRequest, ...errors]);

/** What a procedure prints: its success, tagged `tag`, or what it fails with. */
export const outputOf = <
	Tag extends string,
	Fields extends Schema.Struct.Fields,
	Members extends ReadonlyArray<Schema.Top>,
>(
	tag: Tag,
	success: Schema.Struct<Fields>,
	failure: Schema.Union<Members>,
) =>
	Schema.Union([
		Schema.TaggedStruct(tag, success.fields),
		...failure.members,
	]);
