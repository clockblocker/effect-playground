import { Schema } from "effect";

/**
 * The BFF couldn't reach the backend: it isn't running, or the BFF was
 * started without it. Only the backend endpoint and procedure fail with it.
 * It belongs to the BFF↔backend bridge, not to the backend protocol, so it is
 * defined here rather than in C++, message included.
 */
export class BackendUnavailable extends Schema.TaggedError<BackendUnavailable>()(
	"BackendUnavailable",
	{
		/** Why, such as "127.0.0.1:61234 did not answer in 5 s". */
		detail: Schema.String,
	},
) {
	override get message(): string {
		return `The backend is unavailable: ${this.detail}`;
	}
}
