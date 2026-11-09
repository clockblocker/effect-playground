/*
Generated
- from: cpp/include/protocol.hpp
- by: scripts/generate.ts
*/

import { Schema } from "effect";
import { IoFailed } from "../common/tagged-errors.ts";

/** Generated from [cpp/include/protocol.hpp](../../../../../cpp/include/protocol.hpp) by [scripts/generate.ts](../../../../../scripts/generate.ts). */
export namespace ReadFile {
	export const Request = Schema.Struct({
		name: Schema.String.check(
			Schema.isMinCodePoints(5),
			Schema.isMaxCodePoints(25),
			Schema.isPattern(/^(?!\.\.?$)[^/\\]*$/u),
			Schema.isPattern(/^.+\.txt$/u),
		),
	});
	export interface Request extends Schema.Schema.Type<typeof Request> {}

	export const Success = Schema.Struct({
		contents: Schema.String,
	});
	export interface Success extends Schema.Schema.Type<typeof Success> {}

	export const RequestShape = Schema.Struct({
		name: Schema.String,
	});
	export interface RequestShape
		extends Schema.Schema.Type<typeof RequestShape> {}

	export const Path = Schema.Union([
		Schema.Tuple([Schema.Literal("name")]),
		Schema.Tuple([]),
	]);
	export type Path = typeof Path.Type;

	export const Issue = Schema.Struct({
		message: Schema.String,
		path: Path,
	});
	export interface Issue extends Schema.Schema.Type<typeof Issue> {}

	export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
		"InvalidRequest",
		{
			issues: Schema.NonEmptyArray(Issue),
		},
	) {
		override get message(): string {
			return this.issues.map((issue) => issue.message).join("; ");
		}
	}

	export const Failure = Schema.Union([InvalidRequest, IoFailed]);
	export type Failure = InvalidRequest | IoFailed;

	export const Output = Schema.Union([
		Schema.TaggedStruct("Success", Success.fields),
		InvalidRequest,
		IoFailed,
	]);
	export type Output = typeof Output.Type;
}
