import { describe, expect, test } from "bun:test";
import { Cause, Match } from "effect";
import { HttpClientError, HttpClientRequest } from "effect/http";
import { AsyncResult } from "effect/reactivity";
import { RpcClientError } from "effect/rpc";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ErrorOption } from "react-hook-form";
import {
	type FormFailure,
	Outcome,
	setIssues,
} from "../src/client/forms/shared.tsx";
import { CustomCat } from "../src/shared/generated/generated.ts";
import { CliFailed } from "../src/shared/helpers/tagged-errors.ts";

type Result = AsyncResult.AsyncResult<CustomCat.Success, FormFailure>;

/** What Outcome renders for a copy's result. */
const shown = (result: Result) =>
	renderToStaticMarkup(
		createElement(Outcome<CustomCat.Success>, {
			result,
			children: ({ bytesCopied }) => `Copied ${bytesCopied} bytes.`,
		}),
	);

const failed = (cause: Cause.Cause<FormFailure>) =>
	shown(AsyncResult.failure(cause));

const invalid = new CustomCat.InvalidRequest({
	issues: [
		{ message: "first", path: ["outputFile"] },
		{ message: "second", path: ["outputFile"] },
		{ message: "No such file or directory", path: ["inputFile"] },
	],
});

const transport = new RpcClientError.RpcClientError({
	reason: HttpClientError.HttpClientErrorSchema.fromHttpClientError(
		new HttpClientError.HttpClientError({
			reason: new HttpClientError.TransportError({
				request: HttpClientRequest.post("http://127.0.0.1:5200/rpc"),
				cause: new TypeError("fetch failed"),
			}),
		}),
	),
});

describe("setIssues", () => {
	test("puts the first issue of each field under it", () => {
		const errors: Array<[string, ErrorOption]> = [];
		setIssues(invalid.issues, (name, error) => errors.push([name, error]));
		expect(errors).toEqual([
			["outputFile", { type: "server", message: "first" }],
			[
				"inputFile",
				{ type: "server", message: "No such file or directory" },
			],
		]);
	});
});

describe("Outcome", () => {
	test("shows the success, and nothing before one", () => {
		expect(shown(AsyncResult.success({ bytesCopied: 6 }))).toBe(
			"Copied 6 bytes.",
		);
		expect(shown(AsyncResult.initial())).toBe("");
	});

	test("shows nothing for an interruption, or an InvalidRequest, whose issues go under the fields", () => {
		expect(failed(Cause.interrupt(1))).toBe("");
		expect(failed(Cause.fail(invalid))).toBe("");
	});

	test("shows a failure of what the BFF depends on by its message", () => {
		expect(
			failed(
				Cause.fail(
					new CliFailed({
						message: "custom_cat timed out after 5000 ms",
					}),
				),
			),
		).toBe(`<p role="alert">custom_cat timed out after 5000 ms</p>`);
	});

	test("shows a defect as something gone wrong, and no more, even beside an interruption", () => {
		const defect = Cause.die(new Error("custom_cat failed: secret"));
		expect(failed(defect)).toBe(
			`<p role="alert">Something went wrong.</p>`,
		);
		expect(failed(Cause.combine(defect, Cause.interrupt(1)))).toBe(
			`<p role="alert">Something went wrong.</p>`,
		);
	});

	test("words a transport error by its cause", () => {
		expect(failed(Cause.fail(transport))).toBe(
			`<p role="alert">Request failed: Transport error (POST http://127.0.0.1:5200/rpc)</p>`,
		);
	});

	test("hides a failure while the next submit waits, but keeps a success", () => {
		expect(
			shown(
				AsyncResult.failure(Cause.fail(transport), { waiting: true }),
			),
		).toBe("");
		expect(
			shown(AsyncResult.success({ bytesCopied: 6 }, { waiting: true })),
		).toBe("Copied 6 bytes.");
	});
});

// Checked by `bun run check`: a handler too few, CliFailed's, and neither
// matcher compiles.
const rendered = (result: Result) =>
	AsyncResult.builder(result)
		.onInitial(() => "")
		.onSuccess(() => "")
		.onErrorTag("InvalidRequest", () => "")
		.onErrorTag("IoFailed", () => "")
		.onErrorTag("RpcClientError", () => "")
		.onDefect(() => "")
		.onInterrupt(() => "")
		// @ts-expect-error CliFailed has no handler.
		.exhaustive();
const submitted = (failure: FormFailure) =>
	// @ts-expect-error CliFailed has no handler.
	Match.valueTags(failure, {
		InvalidRequest: () => "",
		IoFailed: () => "",
		RpcClientError: () => "",
	});

test("the matchers' types hold", () => {
	expect([rendered, submitted]).toHaveLength(2);
});
