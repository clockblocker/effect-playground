// How the REST API answers an operation's errors: each with its tag's
// status, from one table, so an endpoint lists its operation's Failure, not
// each error by hand.

import type { Schema } from "effect";
import { HttpApiMiddleware } from "effect/http-api";
import { withStatus } from "./with-status.ts";

const STATUS_CODE_FOR_TAG = {
	InvalidRequest: 422, // The request's fields are wrong.
	IoFailed: 500, // The disk failed, the BFF's or an executable's: not the client's fault.
	CliFailed: 503, // A C++ operation is a service the BFF depends on, like a backend.
} as const;

/** An error class, whose tag has a status: a new tag doesn't compile until it has one. */
type Tagged = Schema.Top & {
	readonly Type: { readonly _tag: keyof typeof STATUS_CODE_FOR_TAG };
	readonly fields: {
		readonly _tag: {
			readonly schema: {
				readonly literal: keyof typeof STATUS_CODE_FOR_TAG;
			};
		};
	};
};

type WithStatus<S extends Schema.Top> = Schema.Codec<
	S["Type"],
	S["Encoded"],
	S["DecodingServices"],
	S["EncodingServices"]
>;

const withItsStatus = <S extends Tagged>(error: S): WithStatus<S> =>
	withStatus(STATUS_CODE_FOR_TAG[error.fields._tag.schema.literal])(error);

export const errorsOf = <
	const Members extends ReadonlyArray<Tagged>,
	const More extends ReadonlyArray<Tagged>,
>(
	failure: Schema.Union<Members>,
	...more: More
): [
	...{ readonly [K in keyof Members]: WithStatus<Members[K]> },
	...{ readonly [K in keyof More]: WithStatus<More[K]> },
] => [...failure.members, ...more].map(withItsStatus) as never;

export const SchemaErrorsOf =
	<Self>() =>
	<const Id extends string, I extends Tagged>(
		id: Id,
		operation: { readonly InvalidRequest: I },
	) =>
		HttpApiMiddleware.Service<Self>()(id, {
			error: withItsStatus(operation.InvalidRequest),
		});
