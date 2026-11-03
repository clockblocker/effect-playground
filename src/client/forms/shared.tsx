import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Match, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { RpcClientError } from "effect/rpc";
import { type ReactNode, useId, useMemo } from "react";
import type {
	FieldError,
	FieldValues,
	Resolver,
	UseFormRegisterReturn,
} from "react-hook-form";
import type {
	FileNotFound,
	NotTxtFile,
} from "../../shared/generated/protocol.ts";

/** What either form's mutation can fail with. */
type Failure = NotTxtFile | FileNotFound | RpcClientError.RpcClientError;

/**
 * What the page says when a call fails. The domain errors say it themselves;
 * the transport error is the client's own, so its wording lives here.
 */
const describeFailure = Match.type<Failure>().pipe(
	Match.tag("RpcClientError", (error) => `Request failed: ${error.message}`),
	Match.orElse((error) => error.message),
);

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

/** A mutation's latest result: its success, its failure's wording, or nothing yet. */
export function Outcome<A>({
	result,
	children,
}: {
	result: AsyncResult.AsyncResult<A, Failure>;
	children: (value: A) => ReactNode;
}) {
	return AsyncResult.matchWithError(result, {
		onInitial: () => null,
		onSuccess: ({ value }) => children(value),
		onError: (error) => <p role="alert">{describeFailure(error)}</p>,
		// No typed error in the cause: a defect or an interruption.
		onDefect: () => <p role="alert">Something went wrong.</p>,
	});
}
