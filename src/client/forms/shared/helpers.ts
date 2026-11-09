import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Exit, Option, Schema } from "effect";
import { useMemo } from "react";
import type { ErrorOption, FieldValues, Resolver } from "react-hook-form";
import { type FieldOf, fieldOf } from "../../../shared/helpers/field-of.ts";
import {
	type AnyInvalidRequest,
	type AnyIssue,
	isInvalidRequest,
} from "../../../shared/helpers/procedure.ts";

type IssueOf<E> = Extract<E, AnyInvalidRequest>["issues"][number];

// Outcome shows any other failure.
export function issuesOf<E>(
	exit: Exit.Exit<unknown, E>,
): ReadonlyArray<IssueOf<E>> {
	const failure = Exit.findErrorOption(exit);
	if (Option.isNone(failure)) return [];
	return isInvalidRequest(failure.value)
		? (failure.value.issues as ReadonlyArray<IssueOf<E>>)
		: [];
}

export function setIssues<I extends AnyIssue>(
	issues: ReadonlyArray<I>,
	setError: (name: FieldOf<I["path"]>, error: ErrorOption) => void,
): void {
	const named = new Set<string>();
	for (const issue of issues) {
		const field = fieldOf<I["path"]>(issue.path);
		if (named.has(field)) continue;
		named.add(field);
		setError(field, { type: "server", message: issue.message });
	}
}

export function useSchemaResolver<
	S extends Schema.ConstraintDecoder<unknown> & {
		readonly Encoded: FieldValues;
	},
>(schema: S): Resolver<S["Encoded"], unknown, S["Type"]> {
	return useMemo(
		() =>
			standardSchemaResolver<
				S["Encoded"] & FieldValues,
				unknown,
				S["Type"]
			>(Schema.toStandardSchemaV1(schema)),
		[schema],
	);
}
