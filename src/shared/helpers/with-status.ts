// HttpApiSchema.status keeps what a schema decodes to and from, but Effect
// types the annotated schema by its internals (decodeTo<declareConstructor…>),

import type { Schema } from "effect";
import { HttpApiSchema } from "effect/http-api";

// so hovers turn unreadable. This names just what is kept.
export const withStatus =
	(code: number) =>
	<S extends Schema.Top>(
		self: S,
	): Schema.Codec<
		S["Type"],
		S["Encoded"],
		S["DecodingServices"],
		S["EncodingServices"]
	> =>
		self.pipe(HttpApiSchema.status(code));
