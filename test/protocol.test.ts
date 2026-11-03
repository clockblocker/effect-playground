import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { emit } from "../scripts/protocol/emit.ts";
import { normalize } from "../scripts/protocol/normalize.ts";
import { fieldOf } from "../src/shared/field-of.ts";
import { CustomCat, IoFailed } from "../src/shared/generated/protocol.ts";
import { ReadFile } from "../src/shared/read-file.ts";

// The JSON forms both sides agree on.
const wire = {
	request: { inputFile: "hello.txt", outputFile: "copy.txt" },
	success: { bytesCopied: 6 },
	invalidRequest: {
		_tag: "InvalidRequest",
		issues: [
			{ message: "Must not be the input file", path: ["outputFile"] },
		],
	},
} as const;

// Names that test each rule a name has: 5 to 25 characters, a plain name,
// and .txt.
const names = [
	"hello.txt",
	"..txt",
	"..hello.txt",
	"../hello.txt",
	"dir\\hello.txt",
	"config.json",
	"x.md",
	`${"a".repeat(21)}.txt`,
	`${"a".repeat(22)}.txt`,
];

describe("generated protocol", () => {
	test("structs decode and encode their wire form", () => {
		expect(
			Schema.decodeUnknownSync(CustomCat.Request)(wire.request),
		).toEqual(wire.request);
		expect(Schema.encodeSync(CustomCat.Success)(wire.success)).toEqual(
			wire.success,
		);
		expect(() =>
			Schema.decodeUnknownSync(CustomCat.Request)({
				...wire.request,
				inputFile: 42,
			}),
		).toThrow();
	});

	test("a name must be a plain .txt file name, in Effect's own words", () => {
		const accepts = Schema.is(CustomCat.Request.fields.outputFile);
		expect(names.filter(accepts)).toEqual([
			"hello.txt",
			"..txt",
			"..hello.txt",
			`${"a".repeat(21)}.txt`,
		]);
		expect(() =>
			Schema.decodeUnknownSync(CustomCat.Request)({
				...wire.request,
				inputFile: "a/b.txt",
			}),
		).toThrow(
			String.raw`Expected a string matching the RegExp ^(?!\.\.?$)[^/\\]*$`,
		);
		expect(() =>
			Schema.decodeUnknownSync(CustomCat.Request)({
				...wire.request,
				outputFile: "config.json",
			}),
		).toThrow(String.raw`Expected a string matching the RegExp ^.+\.txt$`);
		expect(() =>
			Schema.decodeUnknownSync(CustomCat.Request)({
				...wire.request,
				inputFile: "x.md",
			}),
		).toThrow("Expected a string with at least 5 code points");
	});

	test("RequestShape is the request without its rules", () => {
		const accepts = Schema.is(CustomCat.RequestShape);
		expect(accepts({ inputFile: "x.md", outputFile: "../x.json" })).toBe(
			true,
		);
		expect(accepts({ inputFile: "hello.txt" })).toBe(false);
		expect(accepts({ inputFile: 42, outputFile: "copy.txt" })).toBe(false);
	});

	test("an InvalidRequest decodes into its class and encodes back", () => {
		const decode = Schema.decodeUnknownSync(CustomCat.Failure);
		const invalid = decode(wire.invalidRequest);
		expect(invalid).toBeInstanceOf(CustomCat.InvalidRequest);
		expect(
			invalid._tag === "InvalidRequest" && invalid.issues[0].path,
		).toEqual(["outputFile"]);
		expect(Schema.encodeSync(CustomCat.Failure)(invalid)).toEqual(
			wire.invalidRequest,
		);
		expect(() => decode({ ...wire.invalidRequest, issues: [] })).toThrow();
		expect(() =>
			decode({
				...wire.invalidRequest,
				issues: [{ ...wire.invalidRequest.issues[0], path: ["file"] }],
			}),
		).toThrow();
	});

	test("IoFailed decodes into its class, whose message is its C++ template", () => {
		const wireForm = {
			_tag: "IoFailed",
			operation: "write",
			file: "x.txt",
			reason: "Read-only file system",
		} as const;
		const failed = Schema.decodeUnknownSync(CustomCat.Failure)(wireForm);
		expect(failed).toBeInstanceOf(IoFailed);
		expect(failed.message).toBe(
			`Couldn't write "x.txt": Read-only file system`,
		);
		expect(Schema.encodeSync(CustomCat.Failure)(failed)).toEqual(wireForm);
		expect(() =>
			Schema.decodeUnknownSync(IoFailed)({
				...wireForm,
				operation: "delete",
			}),
		).toThrow();
	});

	test("an issue's path is one of its method's fields, or the whole request", () => {
		const accepts = Schema.is(CustomCat.Path);
		expect(accepts(["inputFile"])).toBe(true);
		expect(accepts(["outputFile"])).toBe(true);
		expect(accepts(["name"])).toBe(false);
		expect(accepts(["inputFile", 0])).toBe(false);
		expect(accepts([])).toBe(true);
	});

	test("its message joins the issues' messages, and none of it is sent", () => {
		const invalid = new CustomCat.InvalidRequest({
			issues: [
				{ message: "No such file or directory", path: ["inputFile"] },
				{ message: "Required", path: ["outputFile"] },
			],
		});
		expect(invalid.message).toBe("No such file or directory; Required");
		expect(String(invalid)).toStartWith("InvalidRequest: ");
		expect(
			Object.keys(Schema.encodeSync(CustomCat.InvalidRequest)(invalid)),
		).toEqual(["_tag", "issues"]);
	});

	test("an issue is just a message and a path, and the schema has no templates for it", async () => {
		const schema = await Bun.file(
			new URL("../cpp/protocol.schema.json", import.meta.url),
		).json();
		expect(Object.keys(schema.$defs.protocol__Issue.properties)).toEqual([
			"message",
			"path",
		]);
		expect(Object.keys(schema)).not.toContain("x-issues");
	});

	test("fieldOf names a path the way react-hook-form does", () => {
		expect(fieldOf(["inputFile"])).toBe("inputFile");
		expect(fieldOf(["files", 2, "input"])).toBe("files.2.input");
	});

	test("an InvalidRequest can be raised and caught by tag", async () => {
		const caught = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* Schema.decodeUnknownSync(
					CustomCat.InvalidRequest,
				)(wire.invalidRequest);
			}).pipe(
				Effect.catchTags({
					InvalidRequest: ({ issues }) => Effect.succeed(issues),
				}),
			),
		);
		expect(caught).toEqual(wire.invalidRequest.issues);
	});
});

describe("ReadFile", () => {
	test("a name has the rules a copy's names have", () => {
		expect(names.filter(Schema.is(ReadFile.Request.fields.name))).toEqual(
			names.filter(Schema.is(CustomCat.Request.fields.inputFile)),
		);
		expect(Schema.is(ReadFile.RequestShape)({ name: "x.md" })).toBe(true);
	});

	test("an issue's path is its one field, or the whole request", () => {
		expect(Schema.is(ReadFile.Path)(["name"])).toBe(true);
		expect(Schema.is(ReadFile.Path)([])).toBe(true);
		expect(Schema.is(ReadFile.Path)(["inputFile"])).toBe(false);
	});
});

/** reflect-cpp's shapes for what protocol_schema prints. */
function fixture() {
	const method = (payload: string, success: string) => ({
		type: "object",
		properties: {
			payload: { $ref: `#/$defs/a__${payload}` },
			success: { $ref: `#/$defs/a__${success}` },
			error: {
				anyOf: [
					{ $ref: "#/$defs/a__InvalidRequest__tagged" },
					{ $ref: "#/$defs/a__Busy__tagged" },
				],
			},
		},
		required: ["payload", "success", "error"],
	});
	return {
		type: "array",
		prefixItems: [{ $ref: "#/$defs/a__b__Get" }],
		items: false,
		$defs: {
			a__b__Get: method("b__Query", "b__Found"),
			a__b__Query: {
				type: "object",
				properties: {
					files: {
						type: "array",
						items: { $ref: "#/$defs/a__b__Pair" },
					},
					label: {
						description: "What the batch is called.",
						allOf: [
							{ type: "string", minLength: 2 },
							{ type: "string", pattern: "^[a-z]*$" },
						],
					},
					limit: { anyOf: [{ type: "integer" }, { type: "null" }] },
				},
				required: ["files", "label"],
			},
			a__b__Pair: {
				type: "object",
				properties: {
					input: { type: "string", minLength: 3 },
					output: { type: "string" },
				},
				required: ["input", "output"],
			},
			a__b__Found: {
				type: "object",
				properties: { count: { type: "integer" } },
				required: ["count"],
			},
			a__Issue: {
				type: "object",
				properties: {
					message: { type: "string" },
					path: {
						type: "array",
						items: {
							anyOf: [{ type: "string" }, { type: "integer" }],
						},
					},
				},
				required: ["message", "path"],
			},
			a__Busy__tagged: {
				type: "object",
				properties: {
					_tag: { type: "string", enum: ["Busy"] },
					what: { type: "string", description: "What is busy." },
					seconds: { type: "integer" },
				},
				required: ["_tag", "what", "seconds"],
			},
			a__InvalidRequest__tagged: {
				type: "object",
				properties: {
					_tag: { type: "string", enum: ["InvalidRequest"] },
					issues: {
						type: "array",
						items: { $ref: "#/$defs/a__Issue" },
						minItems: 1,
					},
				},
				required: ["_tag", "issues"],
			},
		} as Record<string, Record<string, unknown>>,
		"x-errors": {
			Busy: { message: "{what} is busy for {seconds}s" },
		} as Record<string, Record<string, unknown>>,
	};
}

/** The module the emitter writes. */
const emitted = (document: unknown) =>
	emit(normalize(document), ["header"]).source;

// Under node_modules, so that the module finds effect.
mkdirSync(join(import.meta.dir, "../node_modules/.cache"), { recursive: true });
const scratch = mkdtempSync(
	join(import.meta.dir, "../node_modules/.cache/emitted-"),
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Imports what the emitter writes for `document`. */
async function load(document: unknown) {
	const path = join(scratch, `${crypto.randomUUID()}.ts`);
	await Bun.write(path, emitted(document));
	return import(path);
}

describe("emitter", () => {
	test("writes one module, with a namespace per method", () => {
		const { file, source } = emit(normalize(fixture()), ["header"]);
		expect(file).toBe("a-b.ts");
		expect(source).toStartWith("// header\n");
		expect(source).toContain("export namespace Get {");
		expect(source).toContain("export const Request = Schema.Struct({");
		expect(source).toContain(
			"export interface Request extends Schema.Schema.Type<typeof Request> {}",
		);
		expect(source).toContain("export const Success = Schema.Struct({");
		expect(source).toContain(
			"export const Failure = Schema.Union([InvalidRequest, Busy]);\nexport type Failure = InvalidRequest | Busy;",
		);
		expect(source).toContain("/** What the batch is called. */");
		expect(source).toContain("limit: Schema.optionalKey(Schema.Int),");
		expect(source).not.toContain("__");
		expect(source).not.toMatch(/\bas (Request|Success|Failure|Error)\b/);
		expect(source).not.toContain("Query");
	});

	test("lists a path per field, through arrays by index", async () => {
		const { source } = emit(normalize(fixture()), ["header"]);
		expect(source).toContain(
			'export const Path = Schema.Union([Schema.Tuple([Schema.Literal("files"), Schema.Int, Schema.Literal("input")]), Schema.Tuple([Schema.Literal("files"), Schema.Int, Schema.Literal("output")]), Schema.Tuple([Schema.Literal("label")]), Schema.Tuple([Schema.Literal("limit")]), Schema.Tuple([])]);',
		);
		const { Get } = await load(fixture());
		const accepts = Schema.is(Get.Path);
		expect(accepts(["files", 2, "input"])).toBe(true);
		expect(accepts(["files", 0, "output"])).toBe(true);
		expect(accepts(["label"])).toBe(true);
		expect(accepts(["files"])).toBe(false);
		expect(accepts(["files", "2", "input"])).toBe(false);
		expect(accepts(["files", 2, "label"])).toBe(false);
		expect(accepts([])).toBe(true);
		const decode = Schema.decodeUnknownSync(Get.InvalidRequest);
		expect(
			decode({
				_tag: "InvalidRequest",
				issues: [
					{
						message: "odd",
						path: ["files", 2, "input"],
					},
				],
			}).issues[0].path,
		).toEqual(["files", 2, "input"]);
		expect(() =>
			decode({
				_tag: "InvalidRequest",
				issues: [{ message: "odd", path: ["nope"] }],
			}),
		).toThrow();
	});

	test("leaves each check Effect's own message", async () => {
		expect(emitted(fixture())).not.toContain("{ message:");
		const { Get } = await load(fixture());
		const decode = Schema.decodeUnknownSync(Get.Request);
		expect(() => decode({ files: [], label: "a" })).toThrow(
			"Expected a string with at least 2 code points",
		);
		expect(() => decode({ files: [], label: "AB" })).toThrow(
			"Expected a string matching the RegExp ^[a-z]*$",
		);
	});

	test("writes RequestShape, the request without its checks, nested structs inlined", async () => {
		expect(emitted(fixture())).toContain(
			"export const RequestShape = Schema.Struct({",
		);
		const { Get } = await load(fixture());
		const request = { files: [{ input: "x", output: "y" }], label: "AB" };
		expect(Schema.is(Get.Request)(request)).toBe(false);
		expect(Schema.is(Get.RequestShape)(request)).toBe(true);
		expect(
			Schema.is(Get.RequestShape)({
				files: [{ input: 1, output: "y" }],
				label: "AB",
			}),
		).toBe(false);
		expect(Schema.is(Get.RequestShape)({ files: [] })).toBe(false);
	});

	test("rejects an Issue with more than a message and a path", () => {
		const document = fixture();
		Object.assign(document.$defs.a__Issue?.properties as object, {
			code: { type: "string" },
		});
		expect(() => normalize(document)).toThrow(
			"Issue must have just `message` (a string) and `path` (an array)",
		);
	});

	test("declares each other error once, its message its template", async () => {
		const source = emitted(fixture());
		expect(source.match(/export class Busy /g)).toHaveLength(1);
		expect(source.indexOf("export class Busy ")).toBeLessThan(
			source.indexOf("export namespace"),
		);
		const { Busy, Get } = await load(fixture());
		const busy = Schema.decodeUnknownSync(Get.Failure)({
			_tag: "Busy",
			what: "disk",
			seconds: 3,
		});
		expect(busy).toBeInstanceOf(Busy);
		expect(busy.message).toBe("disk is busy for 3s");
	});

	test("rejects an error without a template, or whose template names no field", () => {
		const document = fixture();
		document["x-errors"].Busy = { message: "{who} is busy" };
		expect(() => normalize(document)).toThrow(
			"Busy's message names {who}, which isn't one of its fields",
		);
		delete document["x-errors"].Busy;
		expect(() => normalize(document)).toThrow(
			'Busy has no message template in "x-errors"',
		);
	});

	test("rejects an error field that would shadow Error's own", () => {
		const document = fixture();
		Object.assign(document.$defs.a__Busy__tagged?.properties as object, {
			message: { type: "string" },
		});
		expect(() => normalize(document)).toThrow(
			"Busy.message would shadow Error.message; rename the field",
		);
	});

	test("rejects an error other than InvalidRequest", () => {
		const document = fixture();
		document.$defs.a__b__Get = {
			...document.$defs.a__b__Get,
			properties: {
				...(document.$defs.a__b__Get?.properties as object),
				error: { $ref: "#/$defs/a__b__Found" },
			},
		};
		expect(() => normalize(document)).toThrow(
			'Get.error must be rfl::TaggedUnion<"_tag", InvalidRequest, …>',
		);
	});

	test("rejects an InvalidRequest field that would shadow Error's own", () => {
		const document = fixture();
		Object.assign(
			document.$defs.a__InvalidRequest__tagged?.properties as object,
			{ message: { type: "string" } },
		);
		expect(() => normalize(document)).toThrow(
			"InvalidRequest.message would shadow Error.message; rename the field",
		);
	});

	test("fails on a struct named after a namespace member", () => {
		const document = fixture();
		const pair = document.$defs.a__b__Pair;
		delete document.$defs.a__b__Pair;
		document.$defs.a__b__Path = pair ?? {};
		Object.assign(document.$defs.a__b__Query?.properties as object, {
			files: { type: "array", items: { $ref: "#/$defs/a__b__Path" } },
		});
		expect(() => emitted(document)).toThrow(
			"Path would clash with Get.Path; rename the struct",
		);
	});

	test("fails on a struct that refers to the success by its C++ name", () => {
		const document = fixture();
		Object.assign(document.$defs.a__b__Pair?.properties as object, {
			found: { $ref: "#/$defs/a__b__Found" },
		});
		expect(() => emitted(document)).toThrow(
			"Pair refers to Found, which Get declares as Success",
		);
	});
});

describe("emitter, for methods that share a struct", () => {
	const shared = () => {
		const document = fixture();
		document.prefixItems.push({ $ref: "#/$defs/a__b__Put" });
		document.$defs.a__b__Put = {
			...document.$defs.a__b__Get,
			properties: {
				...(document.$defs.a__b__Get?.properties as object),
				payload: { $ref: "#/$defs/a__b__Item" },
				success: { $ref: "#/$defs/a__b__Stored" },
			},
		};
		document.$defs.a__b__Item = {
			type: "object",
			properties: { pair: { $ref: "#/$defs/a__b__Pair" } },
			required: ["pair"],
		};
		document.$defs.a__b__Stored = {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		};
		return document;
	};

	test("declares it once, before the namespaces", () => {
		const source = emitted(shared());
		expect(source.match(/export const Pair = /g)).toHaveLength(1);
		expect(source.indexOf("export const Pair = ")).toBeLessThan(
			source.indexOf("export namespace"),
		);
	});

	test("gives each method its own Path and InvalidRequest", async () => {
		const { Get, Put } = await load(shared());
		expect(Schema.is(Put.Path)(["pair", "input"])).toBe(true);
		expect(Schema.is(Get.Path)(["pair", "input"])).toBe(false);
		expect(Put.InvalidRequest).not.toBe(Get.InvalidRequest);
	});

	test("fails on a payload two methods share, rather than name it twice", () => {
		const document = shared();
		Object.assign(document.$defs.a__b__Put?.properties as object, {
			payload: { $ref: "#/$defs/a__b__Query" },
		});
		expect(() => emitted(document)).toThrow(
			"Query is used by Get and Put, but Get declares it as Request",
		);
	});
});
