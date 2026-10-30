import { Schema } from "effect";

/** Which implementation reads the file: the Bun server or the C++ reader. */
export const Reader = Schema.Literals(["bun", "cpp"]);
export type Reader = typeof Reader.Type;
