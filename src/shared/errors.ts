import { Schema } from "effect";
import { Reader } from "./reader.ts";

// Errors are schemas, so they cross the wire and arrive on the client as the
// same classes. NotTxtFile and FileNotFound come from the C++ protocol, so the
// Bun and C++ readers fail with one definition of each.
export {
	FileNotFound,
	NotTxtFile,
	ReadFileError,
} from "./generated/reader-protocol.ts";

/**
 * The Bun server couldn't reach the C++ reader: it isn't running, or the
 * server was started without it. Only the C++ endpoint and procedure fail
 * with it. It belongs to the Bun↔C++ bridge, not to the C++ protocol, so it
 * is defined here rather than in C++.
 */
export class ReaderUnavailable extends Schema.TaggedError<ReaderUnavailable>()(
	"ReaderUnavailable",
	{ reader: Reader, message: Schema.String },
) {}
