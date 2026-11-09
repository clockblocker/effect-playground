// How the REST API answers an operation's errors, whatever they are, by the
// layer they come from: its InvalidRequest is the client's fault; CliFailed,
// the BFF failing to run a C++ operation, is a service it depends on
// failing; and any other error, such as a disk that failed, is the server's.
// An endpoint lists its operation's failure, not each error by hand.

import type { Schema } from "effect";
import { HttpApiMiddleware } from "effect/http-api";
import { isInvalidRequestClass } from "./procedure.ts";
import { CliFailed } from "./tagged-errors.ts";
import { withStatus } from "./with-status.ts";

/** An error class: a schema whose `_tag` field is a literal. */
type Tagged = Schema.Top & {
	readonly fields: {
		readonly _tag: { readonly schema: { readonly literal: string } };
	};
};

type WithStatus<S extends Schema.Top> = Schema.Codec<
	S["Type"],
	S["Encoded"],
	S["DecodingServices"],
	S["EncodingServices"]
>;

const withItsStatus = <S extends Tagged>(error: S): WithStatus<S> =>
	withStatus(
		isInvalidRequestClass(error)
			? 422
			: (error as Schema.Top) === CliFailed
				? 503
				: 500,
	)(error);

export const errorsOf = <const Members extends ReadonlyArray<Tagged>>(
	failure: Schema.Union<Members>,
): { readonly [K in keyof Members]: WithStatus<Members[K]> } =>
	failure.members.map(withItsStatus) as never;

export const SchemaErrorsOf =
	<Self>() =>
	<const Id extends string, I extends Tagged>(
		id: Id,
		operation: { readonly InvalidRequest: I },
	) =>
		HttpApiMiddleware.Service<Self>()(id, {
			error: withItsStatus(operation.InvalidRequest),
		});
