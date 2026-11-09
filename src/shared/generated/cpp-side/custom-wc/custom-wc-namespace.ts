/*
Generated
- from: src/shared/generated/cpp-side/custom-wc/custom-wc-dtos.ts
- by: scripts/generate.ts
*/

import { Schema } from "effect";
import {
	failureOf,
	InvalidRequestOf,
	issueOf,
	outputOf,
} from "../../../helpers/procedure.ts";
import * as Dto from "./custom-wc-dtos.ts";

/**
Generated
- from: src/shared/generated/cpp-side/custom-wc/custom-wc-dtos.ts
- by: scripts/generate.ts
*/
export namespace CustomWc {
	export const Request = Dto.Request;
	export interface Request extends Schema.Schema.Type<typeof Request> {}

	export const Success = Dto.Success;
	export interface Success extends Schema.Schema.Type<typeof Success> {}

	export const IoFailed = Dto.IoFailed;
	export type IoFailed = Dto.IoFailed;

	export const RequestShape = Schema.Struct({
		file: Schema.String,
	});
	export interface RequestShape
		extends Schema.Schema.Type<typeof RequestShape> {}

	export const Path = Schema.Union([
		Schema.Tuple([Schema.Literal("file")]),
		Schema.Tuple([]),
	]);
	export type Path = typeof Path.Type;

	export const Issue = issueOf(Path);
	export interface Issue extends Schema.Schema.Type<typeof Issue> {}

	export class InvalidRequest extends InvalidRequestOf<InvalidRequest>()(
		Issue,
	) {}

	export const Failure = failureOf(InvalidRequest, Dto.Errors);
	export type Failure = typeof Failure.Type;

	export const Output = outputOf("Success", Success, Failure);
	export type Output = typeof Output.Type;
}
