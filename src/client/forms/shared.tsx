import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Cause, Exit, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { RpcClientError } from "effect/rpc";
import { type ReactNode, useId, useMemo } from "react";
import type {
	ErrorOption,
	FieldError,
	FieldValues,
	Resolver,
	UseFormRegisterReturn,
} from "react-hook-form";
import { type FieldOf, fieldOf } from "../../shared/generated/protocol.ts";

/** What a form's mutation fails with: its method's InvalidRequest, or the transport's error. */
type Failure<Path extends ReadonlyArray<string | number>> =
	| {
			readonly _tag: "InvalidRequest";
			readonly issues: ReadonlyArray<{
				readonly path: Path;
				readonly message: string;
			}>;
	  }
	| RpcClientError.RpcClientError;

/**
 * Puts a failed submit on the form: each issue under its field, where the
 * resolver's errors go, and anything else as `root.server`, which `Outcome`
 * shows. react-hook-form drops them all on the next submit, and a field's
 * when its value changes and passes the resolver.
 */
export function setFailure<Path extends ReadonlyArray<string | number>>(
	exit: Exit.Exit<unknown, Failure<Path>>,
	setError: (name: FieldOf<Path> | "root.server", error: ErrorOption) => void,
): void {
	if (Exit.isSuccess(exit)) return;
	const failure = Cause.findErrorOption(exit.cause);
	if (Option.isNone(failure)) {
		// No typed error in the cause: a defect or an interruption.
		setError("root.server", { message: "Something went wrong." });
	} else if (failure.value._tag === "RpcClientError") {
		// The transport error is the client's own, so its wording lives here.
		setError("root.server", {
			message: `Request failed: ${failure.value.message}`,
		});
	} else {
		// The first issue per field, as the resolver does.
		const named = new Set<string>();
		for (const { path, message } of failure.value.issues) {
			const field = fieldOf(path);
			if (named.has(field)) continue;
			named.add(field);
			setError(field, { type: "server", message });
		}
	}
}

/** A react-hook-form resolver that validates against `schema`. */
export function useSchemaResolver<
	S extends Schema.ConstraintDecoder<unknown> & {
		readonly Encoded: FieldValues;
	},
>(schema: S): Resolver<S["Encoded"], unknown, S["Type"]> {
	// The types come from the schema, spelled out because inference through
	// toStandardSchemaV1's intersection type yields `FieldValues` and `unknown`.
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

export function TextField({
	label,
	field,
	error,
}: {
	label: string;
	field: UseFormRegisterReturn;
	error: FieldError | undefined;
}) {
	const errorId = useId();
	return (
		<div className="field">
			<input
				aria-label={label}
				placeholder={label}
				aria-invalid={error !== undefined}
				aria-describedby={error && errorId}
				{...field}
			/>
			{error && (
				<p id={errorId} className="field-error">
					{error.message}
				</p>
			)}
		</div>
	);
}

/** A mutation's latest success, or in its place the form's `root.server` error. */
export function Outcome<A>({
	result,
	error,
	children,
}: {
	result: AsyncResult.AsyncResult<A, unknown>;
	error: { readonly message?: string } | undefined;
	children: (value: A) => ReactNode;
}) {
	if (error !== undefined) return <p role="alert">{error.message}</p>;
	return AsyncResult.isSuccess(result) ? children(result.value) : null;
}
