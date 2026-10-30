import { Schema } from "effect";

/**
 * The Bun server couldn't reach the C++ reader: it isn't running, or the
 * server was started without it. Only the C++ endpoint and procedure fail
 * with it. It belongs to the Bun↔C++ bridge, not to the C++ protocol, so it
 * is defined here rather than in C++, message included.
 */
export class ReaderUnavailable extends Schema.TaggedError<ReaderUnavailable>()(
	"ReaderUnavailable",
	{
		/** Why, such as "127.0.0.1:61234 did not answer in 5 s". */
		detail: Schema.String,
	},
) {
	override get message(): string {
		return `The C++ reader is unavailable: ${this.detail}`;
	}
}
