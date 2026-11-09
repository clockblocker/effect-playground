/*
Generated
- from: cpp/include/protocol.hpp
- by: scripts/generate.ts
*/

import { Schema } from "effect";

export class IoFailed extends Schema.TaggedError<IoFailed>()("IoFailed", {
	message: Schema.String,
}) {}
