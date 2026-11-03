import { type JsonSchema, Predicate } from "effect";

/** A struct from `cpp/include/protocol.hpp`, under its C++ name. */
export interface Definition {
	readonly name: string;
	/** The JSON Schema, with `$ref`s renamed, descriptions removed and objects closed. */
	readonly schema: JsonSchema.JsonSchema;
	/** Field name → the field's `rfl::Description`. */
	readonly docs: ReadonlyMap<string, string>;
	/** Set when the struct is an alternative of an `rfl::TaggedUnion<"_tag", …>`. */
	readonly tag: string | undefined;
}

/** A procedure struct, never sent, naming what it takes and returns. */
export interface Procedure {
	readonly name: string;
	readonly payload: string;
	readonly success: string;
}

/** An issue code's message, from the rule that produces it. */
export interface IssueTemplate {
	readonly code: string;
	/** `{value}` stands for the field's value, `{limit}` for the rule's limit. */
	readonly message: string;
	/** The JSON Schema keyword that carries the limit, such as `minLength`. */
	readonly keyword: string | undefined;
}

export interface Protocol {
	/** The C++ namespace, such as `protocol`. */
	readonly namespace: string;
	readonly procedures: readonly Procedure[];
	readonly definitions: ReadonlyMap<string, Definition>;
	/** In the order of the C++ `IssueCode` enum. */
	readonly issues: readonly IssueTemplate[];
	/** The `Issue` and `InvalidRequest` structs, which every procedure shares. */
	readonly issue: Definition;
	readonly invalidRequest: Definition;
}

const definitionRef = "#/$defs/";
const taggedSuffix = "__tagged";
const issuesKeyword = "x-issues";

/** A `{name}` in a message template; splitting by it alternates text and name. */
export const placeholder = /\{([^{}]*)\}/g;

/**
 * Fields an error can't have, because every JavaScript `Error` has them: a
 * field `name` would turn `String(error)` into `config.json: …`.
 */
const errorOwnFields = new Set(["name", "message", "stack", "cause"]);

/**
 * Reads the JSON Schema that reflect-cpp emits for a procedure struct, or
 * for a `std::tuple` of them, and undoes its encodings: `$defs` keys such as
 * `protocol__Issue` or `protocol__InvalidRequest__tagged` become C++ names,
 * and the `_tag` property of a tagged alternative becomes its tag. Fails on
 * any shape the emitter does not support, rather than emitting something
 * wrong.
 */
export function normalize(document: unknown): Protocol {
	if (!Predicate.isObject(document)) {
		throw new Error("Expected a schema object");
	}
	const roots =
		typeof document.$ref === "string"
			? [document.$ref]
			: Array.isArray(document.prefixItems)
				? document.prefixItems.map((item) =>
						Predicate.isObject(item) &&
						typeof item.$ref === "string"
							? item.$ref
							: "",
					)
				: [];
	if (roots.length === 0 || roots.includes("")) {
		throw new Error(
			"Expected a schema whose root is a $ref into $defs, or a tuple of them",
		);
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

	const procedures = roots.map((ref) => {
		const root = names.get(ref.slice(definitionRef.length));
		if (root === undefined) throw new Error(`Unknown root ${ref}`);
		return { ...root, ...procedure(root.name, definitions) };
	});
	const issues = issueTemplates(document[issuesKeyword]);
	const invalidRequest = required(definitions, "InvalidRequest");
	const issue = required(definitions, "Issue");
	checkInvalidRequest(invalidRequest);
	checkIssue(
		issue,
		issues.map(({ code }) => code),
	);

	for (const { name } of procedures) definitions.delete(name);
	definitions.delete(invalidRequest.name);
	definitions.delete(issue.name);
	return {
		namespace: procedures[0]?.namespace ?? "",
		procedures: procedures.map(
			({ namespace: _, ...procedure }) => procedure,
		),
		definitions,
		issues,
		issue,
		invalidRequest,
	};
}

/** What a procedure struct's `payload` and `success` refer to. */
function procedure(
	name: string,
	definitions: ReadonlyMap<string, Definition>,
): Omit<Procedure, "name"> {
	const schema = definitions.get(name)?.schema;
	const field = (property: string) => {
		const properties = Predicate.isObject(schema?.properties)
			? schema.properties
			: {};
		const field = properties[property];
		if (!Predicate.isObject(field)) {
			throw new Error(`${name} has no ${property} field`);
		}
		return field;
	};
	const refName = (schema: unknown, role: string) => {
		const ref = Predicate.isObject(schema) ? schema.$ref : undefined;
		if (typeof ref !== "string" || !ref.startsWith(definitionRef)) {
			throw new Error(`${name}.${role} must be a struct`);
		}
		return ref.slice(definitionRef.length);
	};
	const error = field("error");
	const alternatives = Array.isArray(error.anyOf) ? error.anyOf : [error];
	const [only] = alternatives;
	if (
		alternatives.length !== 1 ||
		definitions.get(refName(only, "error"))?.tag !== "InvalidRequest"
	) {
		throw new Error(
			`${name}.error must be rfl::TaggedUnion<"_tag", InvalidRequest>: ` +
				"a field's problems are issues, and anything else is a defect",
		);
	}
	return {
		payload: refName(field("payload"), "payload"),
		success: refName(field("success"), "success"),
	};
}

/**
 * The schema's "x-issues": each code's template, whose every `{name}` is
 * `{value}`, or `{limit}` for a code with a keyword.
 */
function issueTemplates(raw: unknown): IssueTemplate[] {
	if (!Predicate.isObject(raw) || Object.keys(raw).length === 0) {
		throw new Error(
			`Expected the issue codes' templates in "${issuesKeyword}"`,
		);
	}
	return Object.entries(raw).map(([code, entry]) => {
		const message = Predicate.isObject(entry) ? entry.message : undefined;
		const keyword = Predicate.isObject(entry) ? entry.keyword : undefined;
		if (typeof message !== "string") {
			throw new Error(`${code} has no message template`);
		}
		if (keyword !== undefined && typeof keyword !== "string") {
			throw new Error(`${code}'s keyword must be a string`);
		}
		const names = keyword === undefined ? ["value"] : ["value", "limit"];
		for (const [, name = ""] of message.matchAll(placeholder)) {
			if (!names.includes(name)) {
				throw new Error(
					`${code}'s message names {${name}}, but only ` +
						`${names.map((n) => `{${n}}`).join(" and ")} can be filled in`,
				);
			}
		}
		return { code, message, keyword };
	});
}

const properties = (definition: Definition) =>
	(definition.schema.properties ?? {}) as Record<
		string,
		Record<string, unknown>
	>;

/** `{ issues }`, a non-empty array of Issue, and no field `Error` has. */
function checkInvalidRequest(definition: Definition): void {
	const { name } = definition;
	const fields = Object.keys(properties(definition)).filter(
		(field) => field !== "_tag",
	);
	for (const field of fields) {
		if (errorOwnFields.has(field)) {
			throw new Error(
				`${name}.${field} would shadow Error.${field}; rename the field`,
			);
		}
	}
	const issues = properties(definition).issues;
	const items = issues?.items;
	if (
		fields.length !== 1 ||
		issues?.type !== "array" ||
		issues.minItems !== 1 ||
		!Predicate.isObject(items) ||
		items.$ref !== `${definitionRef}Issue`
	) {
		throw new Error(
			`${name} must have just \`issues\`, a non-empty array of Issue`,
		);
	}
}

/** `{ code, message, path }`, its codes those that have templates. */
function checkIssue(definition: Definition, codes: readonly string[]): void {
	const { code, message, path } = properties(definition);
	const fields = Object.keys(properties(definition));
	if (
		fields.length !== 3 ||
		message?.type !== "string" ||
		path?.type !== "array"
	) {
		throw new Error(
			"Issue must have just `code`, `message` (a string) and `path` (an array)",
		);
	}
	if (JSON.stringify(code?.enum) !== JSON.stringify(codes)) {
		throw new Error(
			`Issue.code must be the enum ${codes.join(", ")}, the codes with templates`,
		);
	}
}

function required(
	definitions: ReadonlyMap<string, Definition>,
	name: string,
): Definition {
	const definition = definitions.get(name);
	if (definition === undefined) throw new Error(`No definition ${name}`);
	return definition;
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
		schema: { ...raw, properties, additionalProperties: false },
		docs,
		tag,
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
