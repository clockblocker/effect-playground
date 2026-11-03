import { describe, expect, test } from "bun:test";
import { Cause, Exit } from "effect";
import { HttpClientError, HttpClientRequest } from "effect/http";
import { RpcClientError } from "effect/rpc";
import type { ErrorOption } from "react-hook-form";
import { setFailure } from "../src/client/forms/shared.tsx";
import { CliFailed } from "../src/shared/cli-failed.ts";
import { CustomCat } from "../src/shared/generated/protocol.ts";

type Submitted = Exit.Exit<
	CustomCat.Success,
	CustomCat.Failure | CliFailed | RpcClientError.RpcClientError
>;

/** What setFailure puts on the form, field by field. */
function errorsOf(exit: Submitted) {
	const errors: Array<[string, ErrorOption]> = [];
	setFailure(exit, (name, error) => errors.push([name, error]));
	return errors;
}

describe("setFailure", () => {
	test("puts nothing on the form for a success or an interruption", () => {
		expect(errorsOf(Exit.succeed({ bytesCopied: 6 }))).toEqual([]);
		expect(errorsOf(Exit.failCause(Cause.interrupt(1)))).toEqual([]);
	});

	test("puts the first issue of each field under it", () => {
		const exit = Exit.fail(
			new CustomCat.InvalidRequest({
				issues: [
					{
						message: "first",
						path: ["outputFile"],
					},
					{
						message: "second",
						path: ["outputFile"],
					},
					{
						message: "Required",
						path: ["inputFile"],
					},
				],
			}),
		);
		expect(errorsOf(exit)).toEqual([
			["outputFile", { type: "server", message: "first" }],
			["inputFile", { type: "server", message: "Required" }],
		]);
	});

	test("shows a failure of what the BFF depends on by its message", () => {
		const exit = Exit.fail(new CliFailed({ reason: { _tag: "NotFound" } }));
		expect(errorsOf(exit)).toEqual([
			["root.server", { message: "custom_cat can't be found" }],
		]);
	});

	test("shows a defect as something gone wrong, and no more", () => {
		const exit = Exit.die(new Error("custom_cat failed: secret"));
		expect(errorsOf(exit)).toEqual([
			["root.server", { message: "Something went wrong." }],
		]);
	});

	test("words a transport error by its cause", () => {
		const failed = new HttpClientError.HttpClientError({
			reason: new HttpClientError.TransportError({
				request: HttpClientRequest.post("http://127.0.0.1:5200/rpc"),
				cause: new TypeError("fetch failed"),
			}),
		});
		const exit = Exit.fail(
			new RpcClientError.RpcClientError({
				reason: HttpClientError.HttpClientErrorSchema.fromHttpClientError(
					failed,
				),
			}),
		);
		expect(errorsOf(exit)).toEqual([
			[
				"root.server",
				{
					message:
						"Request failed: Transport error (POST http://127.0.0.1:5200/rpc)",
				},
			],
		]);
	});
});
