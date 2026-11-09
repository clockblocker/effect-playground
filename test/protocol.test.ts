import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { loadBunSide } from "../scripts/protocol/bun-side.ts";
import {
	type BunOperation,
	emit,
	type Origin,
} from "../scripts/protocol/emit.ts";
import { normalize, normalizeEffect } from "../scripts/protocol/normalize.ts";
import { CustomCat, ReadFile } from "../src/shared/generated/generated.ts";
import { fieldOf } from "../src/shared/helpers/field-of.ts";

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

	test("IoFailed decodes into its class, whose message is the system's", () => {
		const wireForm = {
			_tag: "IoFailed",
			message: "Read-only file system",
		} as const;
		const failed = Schema.decodeUnknownSync(CustomCat.Failure)(wireForm);
		expect(failed).toBeInstanceOf(CustomCat.IoFailed);
		expect(failed.message).toBe("Read-only file system");
		expect(String(failed)).toBe("IoFailed: Read-only file system");
		expect(Schema.encodeSync(CustomCat.Failure)(failed)).toEqual(wireForm);
		expect(() =>
			Schema.decodeUnknownSync(CustomCat.IoFailed)({ _tag: "IoFailed" }),
		).toThrow();
	});

	test("Output is what custom_cat prints, each kind by its tag", () => {
		const decode = Schema.decodeUnknownSync(
			Schema.fromJsonString(CustomCat.Output),
		);
		expect(decode('{"_tag":"Success","bytesCopied":6}')).toEqual({
			_tag: "Success",
			bytesCopied: 6,
		});
		expect(decode(JSON.stringify(wire.invalidRequest))).toBeInstanceOf(
			CustomCat.InvalidRequest,
		);
		expect(
			decode('{"_tag":"IoFailed","message":"Is a directory"}'),
		).toBeInstanceOf(CustomCat.IoFailed);
		expect(() => decode('{"bytesCopied":6}')).toThrow();
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
				{ message: "Must not be the input file", path: ["outputFile"] },
			],
		});
		expect(invalid.message).toBe(
			"No such file or directory; Must not be the input file",
		);
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
			output: {
				anyOf: [
					{ $ref: `#/$defs/a__${success}__tagged` },
					{ $ref: "#/$defs/a__InvalidRequest__tagged" },
					{ $ref: "#/$defs/a__Busy__tagged" },
				],
			},
		},
		required: ["payload", "output"],
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
			a__b__Found__tagged: {
				type: "object",
				properties: {
					_tag: { type: "string", enum: ["Success"] },
					count: { type: "integer" },
				},
				required: ["_tag", "count"],
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
					message: { type: "string", description: "What is busy." },
					seconds: { type: "integer" },
				},
				required: ["_tag", "message", "seconds"],
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
	};
}

const origin: Origin = {
	cpp: "a.hpp",
	cppHeaders: "a",
	bunSide: "bun",
	by: "gen.ts",
	into: "out",
	helpers: "src/shared/helpers/procedure.ts",
};

/** The files the emitter writes, by path. */
const emittedFiles = (
	document: unknown,
	bunSide: readonly BunOperation[] = [],
) =>
	new Map(
		emit(normalize(document), bunSide, origin).map(({ path, source }) => [
			path,
			source,
		]),
	);

/** The one file the emitter writes at `path`. */
const emittedFile = (document: unknown, path: string) => {
	const source = emittedFiles(document).get(path);
	if (source === undefined) throw new Error(`No file ${path}`);
	return source;
};

/** Every file the emitter writes, one after another. */
const emitted = (document: unknown) =>
	[...emittedFiles(document).values()].join("\n");

// Under node_modules, so that the module finds effect.
mkdirSync(join(import.meta.dir, "../node_modules/.cache"), { recursive: true });
const scratch = mkdtempSync(
	join(import.meta.dir, "../node_modules/.cache/emitted-"),
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Imports the index the emitter writes for `document`, beside the helpers
 * and the bun-side DTOs in `modules`, by path.
 */
async function load(
	document: unknown,
	bunSide: readonly BunOperation[] = [],
	modules: Record<string, string> = {},
) {
	const directory = join(scratch, crypto.randomUUID());
	for (const [path, source] of Object.entries(modules)) {
		await Bun.write(join(directory, path), source);
	}
	for (const [path, source] of emittedFiles(document, bunSide)) {
		await Bun.write(join(directory, origin.into, path), source);
	}
	await Bun.write(
		join(directory, origin.helpers),
		Bun.file(join(import.meta.dir, "..", origin.helpers)),
	);
	return import(join(directory, origin.into, "generated.ts"));
}

describe("emitter", () => {
	test("writes a directory per C++ operation, and an index of them", () => {
		const files = emittedFiles(fixture());
		expect([...files.keys()]).toEqual([
			"cpp-side/get/get-dtos.ts",
			"cpp-side/get/get-namespace.ts",
			"generated.ts",
		]);
		expect(files.get("generated.ts")).toBe(
			[
				"/*",
				"Generated",
				"- from: a.hpp, bun/",
				"- by: gen.ts",
				"*/",
				"",
				'export { Get } from "./cpp-side/get/get-namespace.ts";',
				"",
			].join("\n"),
		);
		expect(files.get("cpp-side/get/get-dtos.ts")).toStartWith(
			"/*\nGenerated\n- from: a/get.hpp\n- by: gen.ts\n*/\n",
		);
		expect(files.get("cpp-side/get/get-namespace.ts")).toStartWith(
			"/*\nGenerated\n- from: out/cpp-side/get/get-dtos.ts\n- by: gen.ts\n*/\n",
		);
		expect(emitted(fixture())).not.toContain("What the batch is called.");
		// The headers, and a link to the DTOs and the source on the namespace.
		expect(emitted(fixture()).match(/\/[*/]/g)).toHaveLength(
			files.size + 1,
		);
		expect(emitted(fixture())).not.toContain("__");
	});

	test("writes the DTOs as C++ declares them, and nothing else", () => {
		const source = emittedFile(fixture(), "cpp-side/get/get-dtos.ts");
		expect(source).toContain('import { Schema } from "effect";\n\n');
		expect(source).toContain("export const Pair = Schema.Struct({");
		expect(source).toContain("export const Request = Schema.Struct({");
		expect(source).toContain("limit: Schema.optionalKey(Schema.Int),");
		expect(source).toContain("export const Success = Schema.Struct({");
		expect(source).toContain(
			'export class Busy extends Schema.TaggedError<Busy>()("Busy", {',
		);
		expect(source).toContain("export const Errors = [Busy] as const;");
		expect(source).not.toMatch(
			/interface|Path|Shape|InvalidRequest|Output/,
		);
		expect(source).not.toContain("Query");
	});

	test("writes the namespace from the DTOs, with a type for each, and the helpers", () => {
		const source = emittedFile(fixture(), "cpp-side/get/get-namespace.ts");
		expect(source).toContain(
			"/** [Get's DTOs](./get-dtos.ts), generated from [a/get.hpp](../../../a/get.hpp) by [gen.ts](../../../gen.ts). */\nexport namespace Get {",
		);
		expect(source).toContain('import * as Dto from "./get-dtos.ts";');
		expect(source).toContain(
			'from "../../../src/shared/helpers/procedure.ts";',
		);
		for (const name of ["Pair", "Request", "Success"]) {
			expect(source).toContain(
				`export const ${name} = Dto.${name};\nexport interface ${name} extends Schema.Schema.Type<typeof ${name}> {}`,
			);
		}
		expect(source).toContain(
			"export const Busy = Dto.Busy;\nexport type Busy = Dto.Busy;",
		);
		expect(source).toContain(
			"export const Issue = issueOf(Path);\nexport interface Issue extends Schema.Schema.Type<typeof Issue> {}",
		);
		expect(source).toContain(
			"export class InvalidRequest extends InvalidRequestOf<InvalidRequest>()(Issue) {}",
		);
		expect(source).toContain(
			"export const Failure = failureOf(InvalidRequest, Dto.Errors);\nexport type Failure = typeof Failure.Type;",
		);
		expect(source).not.toMatch(/\bas (Request|Success|Failure|Error)\b/);
		expect(source).not.toContain("Query");
	});

	test("lists a path per field, through arrays by index", async () => {
		expect(emitted(fixture())).toContain(
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
		// Nor the engine's .annotate({ expected }), each check's own default.
		expect(emitted(fixture())).not.toContain(".annotate(");
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

	test("declares each other error in the DTOs, a field message its message", async () => {
		expect(emitted(fixture()).match(/export class Busy /g)).toHaveLength(1);
		const { Get } = await load(fixture());
		const busy = Schema.decodeUnknownSync(Get.Failure)({
			_tag: "Busy",
			message: "the disk is busy",
			seconds: 3,
		});
		expect(busy).toBeInstanceOf(Get.Busy);
		expect(busy.message).toBe("the disk is busy");
	});

	test("writes Output, the success tagged, or a failure", async () => {
		expect(emitted(fixture())).toContain(
			'export const Output = outputOf("Success", Success, Failure);',
		);
		const { Get } = await load(fixture());
		const decode = Schema.decodeUnknownSync(Get.Output);
		expect(decode({ _tag: "Success", count: 2 })).toEqual({
			_tag: "Success",
			count: 2,
		});
		expect(() => decode({ count: 2 })).toThrow();
		expect(Schema.is(Get.Success)({ count: 2 })).toBe(true);
	});

	test("rejects an error field that would shadow Error's own", () => {
		const document = fixture();
		Object.assign(document.$defs.a__Busy__tagged?.properties as object, {
			name: { type: "string" },
		});
		expect(() => normalize(document)).toThrow(
			"Busy.name would shadow Error.name; rename the field",
		);
	});

	test("rejects an output that isn't a success, then InvalidRequest, then tagged errors", () => {
		const document = fixture();
		document.$defs.a__b__Get = {
			...document.$defs.a__b__Get,
			properties: {
				...(document.$defs.a__b__Get?.properties as object),
				output: { $ref: "#/$defs/a__b__Found__tagged" },
			},
		};
		expect(() => normalize(document)).toThrow(
			'Get.output must be rfl::TaggedUnion<"_tag", Success, InvalidRequest, …>',
		);
	});

	test("rejects an InvalidRequest field that would shadow Error's own", () => {
		const document = fixture();
		Object.assign(
			document.$defs.a__InvalidRequest__tagged?.properties as object,
			{ name: { type: "string" } },
		);
		expect(() => normalize(document)).toThrow(
			"InvalidRequest.name would shadow Error.name; rename the field",
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
			found: { $ref: "#/$defs/a__b__Found__tagged" },
		});
		expect(() => emitted(document)).toThrow(
			"Pair refers to Found, which Get declares as Success",
		);
	});
});

describe("emitter, for operations that use the same struct", () => {
	const both = () => {
		const document = fixture();
		document.prefixItems.push({ $ref: "#/$defs/a__b__Put" });
		const get = document.$defs.a__b__Get?.properties as {
			output: { anyOf: object[] };
		};
		document.$defs.a__b__Put = {
			...document.$defs.a__b__Get,
			properties: {
				payload: { $ref: "#/$defs/a__b__Item" },
				output: {
					anyOf: [
						{ $ref: "#/$defs/a__b__Stored__tagged" },
						...get.output.anyOf.slice(1),
					],
				},
			},
		};
		document.$defs.a__b__Item = {
			type: "object",
			properties: { pair: { $ref: "#/$defs/a__b__Pair" } },
			required: ["pair"],
		};
		document.$defs.a__b__Stored__tagged = {
			type: "object",
			properties: {
				_tag: { type: "string", enum: ["Success"] },
				id: { type: "string" },
			},
			required: ["_tag", "id"],
		};
		return document;
	};

	test("declares it, and each error, in each one's DTOs", () => {
		const files = emittedFiles(both());
		for (const operation of ["get/get", "put/put"]) {
			const dtos = files.get(`cpp-side/${operation}-dtos.ts`);
			expect(dtos).toContain("export const Pair = Schema.Struct({");
			expect(dtos).toContain("export class Busy ");
		}
		expect([...files.keys()].some((path) => path.includes("common"))).toBe(
			false,
		);
	});

	test("gives each its own Path, InvalidRequest and errors", async () => {
		const { Get, Put } = await load(both());
		expect(Schema.is(Put.Path)(["pair", "input"])).toBe(true);
		expect(Schema.is(Get.Path)(["pair", "input"])).toBe(false);
		expect(Put.InvalidRequest).not.toBe(Get.InvalidRequest);
		expect(Put.Busy).not.toBe(Get.Busy);
	});

	test("declares a payload both take as each one's Request", async () => {
		const document = both();
		Object.assign(document.$defs.a__b__Put?.properties as object, {
			payload: { $ref: "#/$defs/a__b__Query" },
		});
		const { Get, Put } = await load(document);
		const request = { files: [], label: "ab" };
		expect(Schema.is(Get.Request)(request)).toBe(true);
		expect(Schema.is(Put.Request)(request)).toBe(true);
	});
});

describe("emitter, for an operation the BFF serves itself", () => {
	const dtos = [
		'import { Schema } from "effect";',
		"export const Request = Schema.Struct({",
		"\tname: Schema.String.check(Schema.isMinCodePoints(2)),",
		"});",
		"export const Success = Schema.Struct({ size: Schema.Int });",
		'export class Gone extends Schema.TaggedError<Gone>()("Gone", {}) {}',
		"export const Errors = [Gone] as const;",
		"",
	].join("\n");
	const look: BunOperation = {
		name: "Look",
		dtos: "bun/look/look-dtos.ts",
		request: normalizeEffect(
			Schema.toJsonSchemaDocument(
				Schema.Struct({
					name: Schema.String.check(Schema.isMinCodePoints(2)),
				}),
			),
			"Request",
		),
		sameStruct: false,
		structs: [],
		errors: ["Gone"],
	};

	test("writes its namespace from its own DTOs, and no DTOs or Output", () => {
		const files = emittedFiles(fixture(), [look]);
		expect([...files.keys()]).toContain("bun-side/look/look-namespace.ts");
		expect([...files.keys()]).not.toContain("bun-side/look/look-dtos.ts");
		const source = files.get("bun-side/look/look-namespace.ts");
		expect(source).toStartWith(
			"/*\nGenerated\n- from: bun/look/look-dtos.ts\n- by: gen.ts\n*/\n",
		);
		expect(source).toContain(
			'import * as Dto from "../../../bun/look/look-dtos.ts";',
		);
		expect(source).toContain(
			"/** [Look's DTOs](../../../bun/look/look-dtos.ts), generated by [gen.ts](../../../gen.ts). */",
		);
		expect(source).toContain(
			"export const RequestShape = Schema.Struct({\nname: Schema.String,\n});",
		);
		expect(source).not.toContain("Output");
		expect(files.get("generated.ts")).toContain(
			'export { Look } from "./bun-side/look/look-namespace.ts";',
		);
	});

	test("builds the same namespace a C++ operation gets", async () => {
		const { Look } = await load(fixture(), [look], {
			"bun/look/look-dtos.ts": dtos,
		});
		expect(Schema.is(Look.Request)({ name: "a" })).toBe(false);
		expect(Schema.is(Look.RequestShape)({ name: "a" })).toBe(true);
		expect(Schema.is(Look.Path)(["name"])).toBe(true);
		expect(Schema.is(Look.Path)(["size"])).toBe(false);
		const gone = Schema.decodeUnknownSync(Look.Failure)({ _tag: "Gone" });
		expect(gone).toBeInstanceOf(Look.Gone);
	});

	test("finds the BFF's own operations by their DTOs' file names", async () => {
		const [readFile, ...others] = await loadBunSide(
			join(import.meta.dir, ".."),
			"src/shared/bun-side",
		);
		expect(others).toEqual([]);
		expect(readFile).toMatchObject({
			name: "ReadFile",
			dtos: "src/shared/bun-side/read-file/read-file-dtos.ts",
			sameStruct: false,
			structs: [],
			errors: ["IoFailed"],
		});
	});
});
