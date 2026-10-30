import { type JsonSchema, Predicate } from "effect";

/** A struct from the backend protocol's C++ header, under its C++ name. */
export interface Definition {
	readonly name: string;
	/** The JSON Schema, with `$ref`s renamed, descriptions removed and objects closed. */
	readonly schema: JsonSchema.JsonSchema;
	/** Field name → the field's `rfl::Description`. */
	readonly docs: ReadonlyMap<string, string>;
	/** Set when the struct is an alternative of an `rfl::TaggedUnion<"_tag", …>`. */
	readonly tag: string | undefined;
	/**
	 * An error's message template, from the struct's `static constexpr
	 * std::string_view message`, with `{field}` standing for a field's value.
	 */
	readonly message: string | undefined;
}

/** The root struct: a procedure, never sent, naming what it takes and returns. */
export interface Procedure {
	readonly name: string;
	readonly payload: string;
	readonly success: string;
	readonly errors: readonly string[];
}

export interface Protocol {
	/** The C++ namespace, such as `backend_protocol`. */
	readonly namespace: string;
	readonly procedures: readonly Procedure[];
	readonly definitions: ReadonlyMap<string, Definition>;
}

const definitionRef = "#/$defs/";
const taggedSuffix = "__tagged";
const messageKeyword = "x-message";

/** A `{field}` in a message template; splitting by it alternates text and field. */
export const placeholder = /\{([^{}]*)\}/g;

/**
 * Fields an error can't have, because every JavaScript `Error` has them: a
 * field `name` would turn `String(error)` into `config.json: …`.
 */
const errorOwnFields = new Set(["name", "message", "stack", "cause"]);

/**
 * Reads the JSON Schema that reflect-cpp emits for the procedure struct and
 * undoes its encodings: `$defs` keys such as `backend_protocol__NotTxtFile` or
 * `backend_protocol__NotTxtFile__tagged` become C++ names, and the `_tag`
 * property of a tagged alternative becomes its tag. Fails on any shape the
 * emitter does not support, rather than emitting something wrong.
 */
export function normalize(document: unknown): Protocol {
	if (!Predicate.isObject(document) || typeof document.$ref !== "string") {
		throw new Error("Expected a schema whose root is a $ref into $defs");
	}
	const defs = Predicate.isObject(document.$defs) ? document.$defs : {};

	const names = new Map<string, { name: string; namespace: string }>();
	for (const key of Object.keys(defs)) {
		const qualified = key.endsWith(taggedSuffix)
			? key.slice(0, -taggedSuffix.length)
			: key;
		const parts = qualified.split("__");
		const name = parts.pop() ?? qualified;
		if ([...names.values()].some((other) => other.name === name)) {
			throw new Error(`Two definitions are both named ${name}`);
		}
		names.set(key, { name, namespace: parts.join("::") });
	}
	const rename = (ref: string) => {
		const entry = names.get(ref.slice(definitionRef.length));
		if (!ref.startsWith(definitionRef) || entry === undefined) {
			throw new Error(`Unsupported $ref ${ref}`);
		}
		return entry.name;
	};

	const definitions = new Map<string, Definition>();
	for (const [key, raw] of Object.entries(defs)) {
		const { name } = names.get(key) ?? { name: key };
		definitions.set(name, normalizeDefinition(name, raw, rename));
	}

	const root = names.get(document.$ref.slice(definitionRef.length));
	if (root === undefined) throw new Error(`Unknown root ${document.$ref}`);
	const rootSchema = definitions.get(root.name)?.schema;
	const field = (property: string) => {
		const properties = Predicate.isObject(rootSchema?.properties)
			? rootSchema.properties
			: {};
		const schema = properties[property];
		if (!Predicate.isObject(schema)) {
			throw new Error(`${root.name} has no ${property} field`);
		}
		return schema;
	};
	const refName = (schema: JsonSchema.JsonSchema, role: string) => {
		const ref = schema.$ref;
		if (typeof ref !== "string" || !ref.startsWith(definitionRef)) {
			throw new Error(`${root.name}.${role} must be a struct`);
		}
		return ref.slice(definitionRef.length);
	};

	const error = field("error");
	const alternatives = Array.isArray(error.anyOf) ? error.anyOf : [error];
	const errors = alternatives.map((alternative) =>
		refName(Predicate.isObject(alternative) ? alternative : {}, "error"),
	);
	for (const name of errors) {
		const definition = definitions.get(name);
		if (definition?.tag !== name) {
			throw new Error(
				`${name} must be an alternative of rfl::TaggedUnion<"_tag", …>`,
			);
		}
		checkError(definition);
	}
	for (const definition of definitions.values()) {
		if (
			definition.message !== undefined &&
			!errors.includes(definition.name)
		) {
			throw new Error(
				`${definition.name} has a message template, but only errors take one`,
			);
		}
	}

	definitions.delete(root.name);
	return {
		namespace: root.namespace,
		procedures: [
			{
				name: root.name,
				payload: refName(field("payload"), "payload"),
				success: refName(field("success"), "success"),
				errors,
			},
		],
		definitions,
	};
}

/**
 * An error needs a message template whose every `{field}` is one of its
 * fields, and no field that would shadow `Error`'s own.
 */
function checkError(definition: Definition): void {
	const { name, message } = definition;
	const fields = Object.keys(definition.schema.properties ?? {}).filter(
		(field) => field !== "_tag",
	);
	for (const field of fields) {
		if (errorOwnFields.has(field)) {
			throw new Error(
				`${name}.${field} would shadow Error.${field}; rename the field`,
			);
		}
	}
	if (message === undefined) {
		throw new Error(
			`${name} has no message template: give the C++ struct a ` +
				`\`static constexpr std::string_view message\`, which the schema ` +
				`carries as "${messageKeyword}"`,
		);
	}
	for (const [, field = ""] of message.matchAll(placeholder)) {
		if (!fields.includes(field)) {
			throw new Error(
				`${name}'s message names {${field}}, but ${name} has no such ` +
					`field (it has ${fields.map((f) => `{${f}}`).join(", ") || "none"})`,
			);
		}
	}
}

function normalizeDefinition(
	name: string,
	raw: unknown,
	rename: (ref: string) => string,
): Definition {
	if (
		!Predicate.isObject(raw) ||
		raw.type !== "object" ||
		!Predicate.isObject(raw.properties)
	) {
		throw new Error(`${name} must be a struct`);
	}
	const { [messageKeyword]: message, ...definition } = raw;
	if (message !== undefined && typeof message !== "string") {
		throw new Error(`${name}'s ${messageKeyword} must be a string`);
	}
	const docs = new Map<string, string>();
	const properties: Record<string, JsonSchema.JsonSchema> = {};
	const required = new Set(Array.isArray(raw.required) ? raw.required : []);
	let tag: string | undefined;
	for (const [field, schema] of Object.entries(raw.properties)) {
		if (!Predicate.isObject(schema))
			throw new Error(`${name}.${field} is not a schema`);
		const { description, ...rest } = schema;
		if (typeof description === "string") docs.set(field, description);
		const rewritten = rewrite(rest, rename);
		properties[field] = required.has(field)
			? rewritten
			: withoutNull(rewritten);
		if (field === "_tag") tag = singleLiteral(rest);
	}
	return {
		name,
		schema: { ...definition, properties, additionalProperties: false },
		docs,
		tag,
		message,
	};
}

/** Renames `$ref`s, closes objects and drops descriptions at any depth. */
function rewrite(
	schema: JsonSchema.JsonSchema,
	rename: (ref: string) => string,
): JsonSchema.JsonSchema {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (key === "description") continue;
		if (key === "$ref" && typeof value === "string") {
			result.$ref = `${definitionRef}${rename(value)}`;
		} else if (Array.isArray(value)) {
			result[key] = value.map((item) =>
				Predicate.isObject(item) ? rewrite(item, rename) : item,
			);
		} else if (Predicate.isObject(value)) {
			result[key] = rewrite(value, rename);
		} else {
			result[key] = value;
		}
	}
	if (result.type === "object" && !("additionalProperties" in result)) {
		result.additionalProperties = false;
	}
	return result;
}

/**
 * reflect-cpp describes a `std::optional<T>` field as a non-required
 * `anyOf: [T, null]`, but writes `std::nullopt` by leaving the field out. The
 * missing key is the optionality, so the null branch goes.
 */
function withoutNull(schema: JsonSchema.JsonSchema): JsonSchema.JsonSchema {
	if (!Array.isArray(schema.anyOf)) return schema;
	const { anyOf, ...rest } = schema;
	const branches = anyOf.filter(
		(branch) => !(Predicate.isObject(branch) && branch.type === "null"),
	);
	const [only] = branches;
	return branches.length === 1 && Predicate.isObject(only)
		? { ...rest, ...only }
		: { ...rest, anyOf: branches };
}

function singleLiteral(schema: JsonSchema.JsonSchema): string | undefined {
	const values = schema.enum;
	return Array.isArray(values) &&
		values.length === 1 &&
		typeof values[0] === "string"
		? values[0]
		: undefined;
}
