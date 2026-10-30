import { Schema } from "effect";

/** Which implementation reads the file: the BFF or the backend. */
export const Reader = Schema.Literals(["bff", "backend"]);
export type Reader = typeof Reader.Type;
