import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { emit } from "../scripts/protocol/emit.ts";
import { normalize } from "../scripts/protocol/normalize.ts";
import {
	CustomCat,
	fieldOf,
	IoFailed,
	IssueMessage,
	ReadFile,
} from "../src/shared/generated/protocol.ts";

// The JSON forms both sides agree on.
const wire = {
	request: { name: "hello.txt" },
	success: { contents: "Hello\n" },
	invalidRequest: {
		_tag: "InvalidRequest",
		issues: [
			{
				message: '"config.json" is not a .txt file',
				path: ["name"],
			},
		],
	},
} as const;

describe("generated protocol", () => {
	test("structs decode and encode their wire form", () => {
		expect(
			Schema.decodeUnknownSync(ReadFile.Request)(wire.request),
		).toEqual(wire.request);
		expect(Schema.encodeSync(ReadFile.Success)(wire.success)).toEqual(
			wire.success,
		);
		expect(() =>
			Schema.decodeUnknownSync(ReadFile.Request)({ name: 42 }),
		).toThrow();
	});

	test("a name must be a plain name, in the C++ rule's words", () => {
		const accepts = Schema.is(CustomCat.Request.fields.outputFile);
		expect(accepts("hello.txt")).toBe(true);
		expect(accepts("..hello.txt")).toBe(true);
		expect(accepts("../hello.txt")).toBe(false);
		expect(accepts("dir\\hello.txt")).toBe(false);
		expect(() =>
			Schema.decodeUnknownSync(ReadFile.Request)({ name: "a/b.txt" }),
		).toThrow(IssueMessage.NotPlainName());
	});

	test("a name must be 5 to 25 characters, in the C++ rules' words", () => {
		const accepts = Schema.is(ReadFile.Request);
		expect(accepts({ name: "a".repeat(4) })).toBe(false);
		expect(accepts({ name: "a".repeat(5) })).toBe(true);
		expect(accepts({ name: "a".repeat(25) })).toBe(true);
		expect(accepts({ name: "a".repeat(26) })).toBe(false);
		expect(() =>
			Schema.decodeUnknownSync(ReadFile.Request)({ name: "x.md" }),
		).toThrow("Must be at least 5 characters long");
		expect(() =>
			Schema.decodeUnknownSync(CustomCat.Request)({
				inputFile: "hello.txt",
				outputFile: "a".repeat(26),
			}),
		).toThrow("Must be at most 25 characters long");
	});

	test("an InvalidRequest decodes into its class and encodes back", () => {
		const decode = Schema.decodeUnknownSync(ReadFile.Failure);
		const invalid = decode(wire.invalidRequest);
		expect(invalid).toBeInstanceOf(ReadFile.InvalidRequest);
		expect(
			invalid._tag === "InvalidRequest" && invalid.issues[0].path,
		).toEqual(["name"]);
		expect(Schema.encodeSync(ReadFile.Failure)(invalid)).toEqual(
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
		expect(Schema.is(ReadFile.Path)(["name"])).toBe(true);
		expect(Schema.is(ReadFile.Path)(["inputFile"])).toBe(false);
	});

	test("its message joins the issues' messages, and none of it is sent", () => {
		const invalid = new CustomCat.InvalidRequest({
			issues: [
				{
					message: IssueMessage.NotTxtFile({ value: "a.json" }),
					path: ["inputFile"],
				},
				{
					message: IssueMessage.Missing(),
					path: ["outputFile"],
				},
			],
		});
		expect(invalid.message).toBe('"a.json" is not a .txt file; Required');
		expect(String(invalid)).toStartWith("InvalidRequest: ");
		expect(
			Object.keys(Schema.encodeSync(CustomCat.InvalidRequest)(invalid)),
		).toEqual(["_tag", "issues"]);
	});

	test("an issue is just a message and a path, each rule's template in IssueMessage", async () => {
		const schema = await Bun.file(
			new URL("../cpp/protocol.schema.json", import.meta.url),
		).json();
		expect(Object.keys(schema.$defs.protocol__Issue.properties)).toEqual([
			"message",
			"path",
		]);
		expect(Object.keys(IssueMessage)).toEqual(
			Object.keys(schema["x-issues"]),
		);
		expect(Object.keys(IssueMessage)).toEqual([
			"Missing",
			"TooShort",
			"TooLong",
			"NotPlainName",
			"NotTxtFile",
			"LeavesFiles",
			"FileNotFound",
			"SameAsInput",
			"SameFileAsInput",
		]);
	});

	test("each rule's message is its C++ template, filled in", () => {
		expect(IssueMessage.TooShort({ limit: 5 })).toBe(
			"Must be at least 5 characters long",
		);
		expect(IssueMessage.FileNotFound({ value: "missing.txt" })).toBe(
			'"missing.txt" does not exist',
		);
	});

	test("fieldOf names a path the way react-hook-form does", () => {
		expect(fieldOf(["inputFile"])).toBe("inputFile");
		expect(fieldOf(["files", 2, "input"])).toBe("files.2.input");
	});

	test("an InvalidRequest can be raised and caught by tag", async () => {
		const caught = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* Schema.decodeUnknownSync(ReadFile.InvalidRequest)(
					wire.invalidRequest,
				);
			}).pipe(
				Effect.catchTags({
					InvalidRequest: ({ issues }) => Effect.succeed(issues),
				}),
			),
		);
		expect(caught).toEqual(wire.invalidRequest.issues);
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
					input: { type: "string" },
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
		"x-issues": {
			Missing: { message: "Required" },
			TooShort: { message: "At least {limit}", keyword: "minLength" },
			Lowercase: { message: "Lowercase only", keyword: "pattern" },
			// Backticks, $ and \ are literal text in the generated function.
			Odd: { message: "`{value}` is odd; $ and \\ stay" },
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

	test("writes each rule's template as a function of its placeholders", async () => {
		const { IssueMessage, fieldOf } = await load(fixture());
		expect(Object.keys(IssueMessage)).toEqual([
			"Missing",
			"TooShort",
			"Lowercase",
			"Odd",
		]);
		expect(IssueMessage.Missing()).toBe("Required");
		expect(IssueMessage.TooShort({ limit: 2 })).toBe("At least 2");
		expect(IssueMessage.Odd({ value: "x" })).toBe(
			"`x` is odd; $ and \\ stay",
		);
		expect(fieldOf(["files", 2, "input"])).toBe("files.2.input");
	});

	test("gives a length bound the message of the rule that carries it", async () => {
		expect(emitted(fixture())).toContain(
			"Schema.isMinCodePoints(2, { message: IssueMessage.TooShort({ limit: 2 }) })",
		);
		const { Get } = await load(fixture());
		expect(() =>
			Schema.decodeUnknownSync(Get.Request)({ files: [], label: "a" }),
		).toThrow("At least 2");
	});

	test("gives a pattern the message of the rule that carries it", async () => {
		expect(emitted(fixture())).toContain(
			'Schema.isPattern(new RegExp("^[a-z]*$", "u"), { message: IssueMessage.Lowercase() })',
		);
		const { Get } = await load(fixture());
		expect(() =>
			Schema.decodeUnknownSync(Get.Request)({ files: [], label: "AB" }),
		).toThrow("Lowercase only");
	});

	test("rejects two rules that carry one keyword, or a keyword rule that names the value", () => {
		const document = fixture();
		document["x-issues"].Odd = { message: "odd", keyword: "pattern" };
		expect(() => normalize(document)).toThrow(
			"Lowercase and Odd both carry pattern",
		);
		document["x-issues"].Odd = { message: "{value}", keyword: "maxLength" };
		expect(() => normalize(document)).toThrow(
			"Odd's message names {value}, but only {limit} can be filled in",
		);
	});

	test("rejects a bound no rule carries", () => {
		const document = fixture();
		delete document["x-issues"].TooShort?.keyword;
		expect(() => emitted(document)).toThrow(
			/\{limit\}, but only \{value\} can be filled in/,
		);
		document["x-issues"].TooShort = { message: "short" };
		expect(() => emitted(document)).toThrow(
			"A field has a minLength, but no rule carries one",
		);
	});

	test("rejects a template with an unknown placeholder", () => {
		const document = fixture();
		document["x-issues"].Odd = { message: "{value} or {name}" };
		expect(() => normalize(document)).toThrow(
			"Odd's message names {name}, but only {value} can be filled in",
		);
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
