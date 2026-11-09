import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Schema } from "effect";
import { useMemo } from "react";
import type { ErrorOption, FieldValues, Resolver } from "react-hook-form";
import { type FieldOf, fieldOf } from "../../../shared/helpers/field-of.ts";

interface FormIssue {
	readonly message: string;
	readonly path: ReadonlyArray<string | number>;
}

export function setIssues<I extends FormIssue>(
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
