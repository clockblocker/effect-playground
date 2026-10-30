import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { emit } from "../scripts/reader-protocol/emit.ts";
import { normalize } from "../scripts/reader-protocol/normalize.ts";
import { ReadFile } from "../src/shared/generated/reader-protocol.ts";

// The payloads the C++ reader puts on the wire.
const wire = {
	request: { name: "hello.txt" },
	success: { contents: "Hello\n" },
	notTxtFile: { _tag: "NotTxtFile", file: "config.json" },
	fileNotFound: { _tag: "FileNotFound", file: "missing.txt" },
} as const;

describe("generated reader protocol", () => {
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

	test("a name must be 5 to 25 characters, as the C++ struct says", () => {
		const accepts = Schema.is(ReadFile.Request);
		expect(accepts({ name: "a".repeat(4) })).toBe(false);
		expect(accepts({ name: "a".repeat(5) })).toBe(true);
		expect(accepts({ name: "a".repeat(25) })).toBe(true);
		expect(accepts({ name: "a".repeat(26) })).toBe(false);
		expect(() =>
			Schema.decodeUnknownSync(ReadFile.Request)({ name: "x.md" }),
		).toThrow("Must be at least 5 characters long");
	});

	test("errors decode into the TaggedError classes and encode back", () => {
		const decode = Schema.decodeUnknownSync(ReadFile.Failure);
		const notTxt = decode(wire.notTxtFile);
		expect(notTxt).toBeInstanceOf(ReadFile.NotTxtFile);
		expect(notTxt.file).toBe("config.json");
		expect(decode(wire.fileNotFound)).toBeInstanceOf(ReadFile.FileNotFound);
		expect(Schema.encodeSync(ReadFile.Failure)(notTxt)).toEqual(
			wire.notTxtFile,
		);
		expect(() => decode({ _tag: "Elsewhere", file: "x" })).toThrow();
	});

	test("errors fill their C++ message template, and send none of it", () => {
		const notTxt = new ReadFile.NotTxtFile({ file: "config.json" });
		expect(notTxt.message).toBe('"config.json" is not a .txt file');
		expect(String(notTxt)).toStartWith(
			'NotTxtFile: "config.json" is not a .txt file',
		);
		expect(new ReadFile.FileNotFound({ file: "missing.txt" }).message).toBe(
			'"missing.txt" does not exist',
		);
		expect(Schema.encodeSync(ReadFile.Failure)(notTxt)).toEqual(
			wire.notTxtFile,
		);
		const decoded = Schema.decodeUnknownSync(ReadFile.Failure)(
			wire.fileNotFound,
		);
		expect(decoded.message).toBe('"missing.txt" does not exist');
	});

	test("errors can be raised and caught by tag", async () => {
		const caught = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* new ReadFile.NotTxtFile({ file: "a.md" });
			}).pipe(
				Effect.catchTags({
					NotTxtFile: (error) =>
						Effect.succeed(`not txt: ${error.file}`),
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
				// Backticks, $ and \ are literal text in the generated getter.
				"x-message": "`{id}` is gone; $ and \\ stay",
				properties: {
					_tag: { type: "string", enum: ["Gone"] },
					id: { type: "integer" },
				},
				required: ["_tag", "id"],
			} as Record<string, unknown>,
		},
	};

	/** The module the emitter writes. */
	const emitted = (document: unknown) =>
		emit(normalize(document), ["header"]).source;

	test("undoes namespaces, wrappers and optionals", () => {
		const source = emitted(schema);
		expect(source).toContain(
			'export class Gone extends Schema.TaggedError<Gone>()("Gone", {',
		);
		expect(source).toContain("/** At most this many. */");
		expect(source).toContain("limit: Schema.optionalKey(Schema.Int),");
		expect(source).toContain("export class AB extends RpcGroup.make(");
		expect(source).not.toContain("__");
	});

	test("writes one module, with a namespace per method", () => {
		const { file, source } = emit(normalize(schema), ["header"]);
		expect(file).toBe("a-b.ts");
		expect(source).toStartWith("// header\n");
		expect(source).toContain("export namespace Get {");
		// The payload is declared as Request, schema and type under one name.
		expect(source).toContain("export const Request = Schema.Struct({");
		expect(source).toContain(
			"export interface Request extends Schema.Schema.Type<typeof Request> {}",
		);
		// Query is the payload and the success too.
		expect(source).toContain("export const Success = Request;");
		expect(source).toContain(
			"export const Failure = Schema.Union([Gone]);\nexport type Failure = typeof Failure.Type;",
		);
		expect(source).toContain(
			'Rpc.make("Get", {\npayload: Get.Request,\nsuccess: Get.Success,\nerror: Get.Failure,',
		);
		// No aliases, and no C++ name for a struct the namespace renames.
		expect(source).not.toMatch(/\bas (Request|Success|Failure|Error)\b/);
		expect(source).not.toContain("Query");
	});

	test("puts each method's errors in its own namespace", () => {
		const get = normalize(schema);
		const put = normalize({
			$ref: "#/$defs/a__b__Put",
			$defs: {
				a__b__Put: {
					type: "object",
					properties: {
						payload: { $ref: "#/$defs/a__b__Item" },
						success: { $ref: "#/$defs/a__b__Stored" },
						error: { $ref: "#/$defs/a__b__Full__tagged" },
					},
					required: ["payload", "success", "error"],
				},
				a__b__Item: {
					type: "object",
					properties: { body: { type: "string" } },
					required: ["body"],
				},
				a__b__Stored: {
					type: "object",
					properties: { id: { type: "integer" } },
					required: ["id"],
				},
				a__b__Full__tagged: {
					type: "object",
					"x-message": "no room for more",
					properties: { _tag: { type: "string", enum: ["Full"] } },
					required: ["_tag"],
				},
			},
		});
		const { source } = emit(
			{
				...get,
				procedures: [...get.procedures, ...put.procedures],
				definitions: new Map([...get.definitions, ...put.definitions]),
			},
			["header"],
		);
		// From a namespace to the next one or to the RPC group.
		const block = (name: string) => {
			const start = source.indexOf(`export namespace ${name} {`);
			const end = source
				.slice(start + 1)
				.search(/^export (namespace|class \w+ extends RpcGroup)/m);
			return source.slice(start, start + 1 + end);
		};
		expect(block("Get")).toContain("export class Gone extends");
		expect(block("Get")).not.toContain("Full");
		expect(block("Put")).toContain("export class Full extends");
		expect(block("Put")).toContain(
			"export const Success = Schema.Struct({",
		);
		expect(block("Put")).toContain(
			"export const Failure = Schema.Union([Full]);",
		);
		expect(source).toContain("error: Get.Failure,");
		expect(source).toContain("error: Put.Failure,");
	});

	test("fails on a struct named after a namespace member", () => {
		const clashing = structuredClone(schema) as {
			$defs: Record<string, Record<string, unknown>>;
		};
		const gone = clashing.$defs.a__b__Gone__tagged ?? {};
		delete clashing.$defs.a__b__Gone__tagged;
		clashing.$defs.a__b__Failure__tagged = {
			...gone,
			properties: {
				...(gone.properties as object),
				_tag: { type: "string", enum: ["Failure"] },
			},
		};
		clashing.$defs.a__b__Get = {
			...clashing.$defs.a__b__Get,
			properties: {
				...(clashing.$defs.a__b__Get?.properties as object),
				error: { $ref: "#/$defs/a__b__Failure__tagged" },
			},
		};
		expect(() => emitted(clashing)).toThrow(
			"Failure would clash with Get.Failure; rename the struct",
		);
	});

	test("fails on a struct that refers to the payload by its C++ name", () => {
		const referring = structuredClone(schema);
		Object.assign(referring.$defs.a__b__Gone__tagged.properties as object, {
			query: { $ref: "#/$defs/a__b__Query" },
		});
		expect(() => emitted(referring)).toThrow(
			"Gone refers to Query, which Get declares as Request",
		);
	});

	test("fails on a definition two methods share, rather than guess", () => {
		const protocol = normalize(schema);
		const [get] = protocol.procedures;
		if (get === undefined) throw new Error("No procedure");
		const shared = {
			...protocol,
			procedures: [get, { ...get, name: "Put" }],
		};
		expect(() => emit(shared, ["header"])).toThrow(
			"Query is used by both Get and Put, and the generator has no module for shared definitions yet",
		);
	});

	test("names length bounds the way a hand-written schema does", () => {
		const bounded = structuredClone(schema);
		Object.assign(bounded.$defs.a__b__Query.properties, {
			// rfl::Validator<std::string, rfl::Size<…>, rfl::Size<…>>
			name: {
				allOf: [
					{ type: "string", minLength: 5 },
					{ type: "string", maxLength: 25 },
				],
			},
			// A bounded array of bounded strings: two schemas, two calls.
			tags: {
				type: "array",
				items: { type: "string", minLength: 2 },
				minItems: 1,
			},
		});
		const source = emitted(bounded);
		expect(source).toContain(
			'name: Schema.optionalKey(Schema.String.check(Schema.isMinCodePoints(5, { message: "Must be at least 5 characters long" }), Schema.isMaxCodePoints(25, { message: "Must be at most 25 characters long" }))),',
		);
		expect(source).toContain(
			'tags: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMinCodePoints(2, { message: "Must be at least 2 characters long" }))).check(Schema.isMinLength(1)',
		);
	});

	test("gives an error a message getter from its template", () => {
		const source = emitted(schema);
		const [, body = ""] =
			/override get message\(\): string \{\nreturn (.*);\n\}/.exec(
				source,
			) ?? [];
		const message = new Function(`return ${body};`).call({ id: 7 });
		expect(message).toBe("`7` is gone; $ and \\ stay");
		expect(source).not.toContain("x-message");
	});

	test("rejects an error without a message template", () => {
		const untemplated = structuredClone(schema);
		delete untemplated.$defs.a__b__Gone__tagged["x-message"];
		expect(() => normalize(untemplated)).toThrow(
			/Gone has no message template/,
		);
	});

	test("rejects a template that names a field the error lacks", () => {
		const misnamed = structuredClone(schema);
		misnamed.$defs.a__b__Gone__tagged["x-message"] = "{id} or {name}";
		expect(() => normalize(misnamed)).toThrow(
			"Gone's message names {name}, but Gone has no such field (it has {id})",
		);
	});

	test("rejects an error field that would shadow Error's own", () => {
		const shadowing = structuredClone(schema);
		Object.assign(shadowing.$defs.a__b__Gone__tagged.properties as object, {
			name: { type: "string" },
		});
		expect(() => normalize(shadowing)).toThrow(
			"Gone.name would shadow Error.name; rename the field",
		);
	});

	test("rejects an error that isn't a tagged alternative", () => {
		const untagged = structuredClone(schema);
		untagged.$defs.a__b__Get.properties.error = {
			anyOf: [{ $ref: "#/$defs/a__b__Query" }],
		};
		expect(() => normalize(untagged)).toThrow(/TaggedUnion/);
	});
});
