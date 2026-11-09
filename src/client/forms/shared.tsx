import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Schema } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import type { RpcClientError } from "effect/rpc";
import { type ReactNode, useId, useMemo } from "react";
import type {
	ErrorOption,
	FieldError,
	FieldValues,
	Resolver,
	UseFormRegisterReturn,
} from "react-hook-form";
import { type FieldOf, fieldOf } from "../../shared/helpers/field-of.ts";
import type {
	customCat,
	customWc,
	readFile,
	searchFile,
} from "../data-access/data-access.ts";

/** What any form's mutation fails with. */
export type FormFailure =
	| Atom.Failure<typeof readFile>
	| Atom.Failure<typeof searchFile>
	| Atom.Failure<typeof customCat>
	| Atom.Failure<typeof customWc>;

type FormIssue = Extract<
	FormFailure,
	{ readonly _tag: "InvalidRequest" }
>["issues"][number];

/**
 * Puts each issue under its field, where the resolver's errors go, the first
 * per field, as the resolver does. react-hook-form drops them on the next
 * submit, and a field's when its value changes and passes the resolver.
 */
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

/**
 * A mutation's latest result: its success, or a message for a failure that
 * isn't about a field. A submit puts an InvalidRequest's issues under the
 * fields, and a cancelled one says nothing: no one is waiting for it.
 */
export function Outcome<A>({
	result,
	children,
}: {
	result: AsyncResult.AsyncResult<A, FormFailure>;
	children: (value: A) => ReactNode;
}) {
	return (
		AsyncResult.builder(AsyncResult.map(result, children))
			.onInitial(() => null)
			.onSuccess((node) => node)
			.onWaiting(() => null)
			.onErrorTag("InvalidRequest", () => null)
			.onErrorTag(["IoFailed", "CliFailed"], ({ message }) => (
				<Alert>{message}</Alert>
			))
			.onErrorTag("RpcClientError", (error) => (
				<Alert>{`Request failed: ${transportMessage(error)}`}</Alert>
			))
			// Before onInterrupt: a defect beside an interruption still shows.
			.onDefect(() => <Alert>Something went wrong.</Alert>)
			.onInterrupt(() => null)
			.exhaustive()
	);
}

function Alert({ children }: { children: ReactNode }) {
	return <p role="alert">{children}</p>;
}

// An HTTP error's own message is empty; its cause, such as a TransportError,
// says what failed and where.
function transportMessage({ reason }: RpcClientError.RpcClientError): string {
	if (reason._tag !== "HttpError") return reason.message;
	const { cause } = reason;
	return cause instanceof Error && cause.message !== ""
		? cause.message
		: reason.kind;
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
