import { Schema } from "effect";
import { IoFailed } from "./generated/protocol.ts";

/**
 * What the ReadFile method takes, succeeds with and fails with. The BFF
 * serves it alone, so it's written here, as the generated CustomCat is from
 * the C++.
 */
export namespace ReadFile {
	/** What ReadFile takes, with the rules the form and BffReader check. */
	export const Request = Schema.Struct({
		/** The file to read, such as "hello.txt", in the files directory. */
		name: Schema.String.check(
			Schema.isMinCodePoints(5),
			Schema.isMaxCodePoints(25),
			Schema.isPattern(/^(?!\.\.?$)[^/\\]*$/u),
			Schema.isPattern(/^.+\.txt$/u),
		),
	});
	export interface Request extends Schema.Schema.Type<typeof Request> {}

	/** What ReadFile takes, its fields' types without their rules. */
	export const RequestShape = Schema.Struct({ name: Schema.String });
	export interface RequestShape
		extends Schema.Schema.Type<typeof RequestShape> {}

	/** What ReadFile succeeds with. */
	export const Success = Schema.Struct({
		/** The whole file, decoded as UTF-8. */
		contents: Schema.String,
	});
	export interface Success extends Schema.Schema.Type<typeof Success> {}

	/** Where in a ReadFile request an issue is: a field, or [] for the whole request. */
	export const Path = Schema.Union([
		Schema.Tuple([Schema.Literal("name")]),
		Schema.Tuple([]),
	]);
	export type Path = typeof Path.Type;

	/** A problem with a ReadFile request. */
	export const Issue = Schema.Struct({ message: Schema.String, path: Path });
	export interface Issue extends Schema.Schema.Type<typeof Issue> {}

	/** What is wrong with a ReadFile request's fields. */
	export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
		"InvalidRequest",
		{ issues: Schema.NonEmptyArray(Issue) },
	) {
		override get message(): string {
			return this.issues.map((issue) => issue.message).join("; ");
		}
	}

	/** What ReadFile fails with. */
	export const Failure = Schema.Union([InvalidRequest, IoFailed]);
	export type Failure = InvalidRequest | IoFailed;
}
