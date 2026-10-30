import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { emit } from "../scripts/reader-protocol/emit.ts";
import { normalize } from "../scripts/reader-protocol/normalize.ts";
import {
	FileNotFound,
	NotTxtFile,
	ReadFileError,
	ReadFileRequest,
	ReadFileSuccess,
} from "../src/shared/generated/reader-protocol.ts";

// The payloads the C++ reader puts on the wire.
const wire = {
	request: { name: "hello.txt" },
	success: { contents: "Hello\n" },
	notTxtFile: { _tag: "NotTxtFile", name: "config.json" },
	fileNotFound: { _tag: "FileNotFound", name: "missing.txt" },
} as const;

describe("generated reader protocol", () => {
	test("structs decode and encode their wire form", () => {
		expect(Schema.decodeUnknownSync(ReadFileRequest)(wire.request)).toEqual(
			wire.request,
		);
		expect(Schema.encodeSync(ReadFileSuccess)(wire.success)).toEqual(
			wire.success,
		);
		expect(() =>
			Schema.decodeUnknownSync(ReadFileRequest)({ name: 42 }),
		).toThrow();
	});

	test("errors decode into the TaggedError classes and encode back", () => {
		const decode = Schema.decodeUnknownSync(ReadFileError);
		const notTxt = decode(wire.notTxtFile);
		expect(notTxt).toBeInstanceOf(NotTxtFile);
		expect(notTxt.name).toBe("config.json");
		expect(decode(wire.fileNotFound)).toBeInstanceOf(FileNotFound);
		expect(Schema.encodeSync(ReadFileError)(notTxt)).toEqual(
			wire.notTxtFile,
		);
		expect(() => decode({ _tag: "Elsewhere", name: "x" })).toThrow();
	});

	test("errors can be raised and caught by tag", async () => {
		const caught = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* new NotTxtFile({ name: "a.md" });
			}).pipe(
				Effect.catchTags({
					NotTxtFile: (error) =>
						Effect.succeed(`not txt: ${error.name}`),
				}),
			),
		);
		expect(caught).toBe("not txt: a.md");
	});
});

describe("emitter", () => {
	// reflect-cpp's shapes for a nested namespace, std::optional and int.
	const schema = {
		$ref: "#/$defs/a__b__Get",
		$defs: {
			a__b__Get: {
				type: "object",
				properties: {
					payload: { $ref: "#/$defs/a__b__Query" },
					success: { $ref: "#/$defs/a__b__Query" },
					error: { anyOf: [{ $ref: "#/$defs/a__b__Gone__tagged" }] },
				},
				required: ["payload", "success", "error"],
			},
			a__b__Query: {
				type: "object",
				properties: {
					limit: {
						type: "integer",
						description: "At most this many.",
					},
				},
				required: [],
			},
			a__b__Gone__tagged: {
				type: "object",
				properties: { _tag: { type: "string", enum: ["Gone"] } },
				required: ["_tag"],
			},
		},
	};

	test("undoes namespaces, wrappers and optionals", () => {
		const source = emit(normalize(schema), ["header"]);
		expect(source).toContain(
			'export class Gone extends Schema.TaggedError<Gone>()("Gone", {',
		);
		expect(source).toContain("/** At most this many. */");
		expect(source).toContain("limit: Schema.optionalKey(Schema.Int),");
		expect(source).toContain("export class AB extends RpcGroup.make(");
		expect(source).not.toContain("__");
	});

	test("rejects an error that isn't a tagged alternative", () => {
		const untagged = structuredClone(schema);
		untagged.$defs.a__b__Get.properties.error = {
			anyOf: [{ $ref: "#/$defs/a__b__Query" }],
		};
		expect(() => normalize(untagged)).toThrow(/TaggedUnion/);
	});
});
