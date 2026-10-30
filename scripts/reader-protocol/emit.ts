import { SchemaRepresentation } from "effect";
import type { Definition, Protocol } from "./normalize.ts";

/**
 * Writes the Effect Schema module for a normalized protocol.
 *
 * Effect's own engine (`fromJsonSchemaDocument` → `toCodeDocument`) translates
 * each field's JSON Schema into a Schema expression. This emitter owns the
 * declarations around them, which that engine cannot express: `TaggedError`
 * classes, struct and type pairs, JSDoc from descriptions, and the RPC group.
 */
export function emit(protocol: Protocol, header: readonly string[]): string {
	const { procedure, definitions } = protocol;
	const errorUnion = `${procedure.name}Error`;
	const group = pascalCase(procedure.namespace || "Protocol");

	const ordered = dependencyOrder(
		[procedure.payload, procedure.success, ...procedure.errors],
		definitions,
	);
	const declarations = ordered.map((name) =>
		declare(required(definitions, name), definitions),
	);

	return [
		...header.map((line) => `// ${line}`),
		"",
		'import { Schema } from "effect";',
		'import { Rpc, RpcGroup } from "effect/rpc";',
		"",
		...declarations,
		`/** Every error ${procedure.name} can fail with. */`,
		`export const ${errorUnion} = Schema.Union([${procedure.errors.join(", ")}]);`,
		`export type ${errorUnion} = typeof ${errorUnion}.Type;`,
		"",
		`/** The C++ reader's procedures, for an Effect RPC client over JSON-RPC. */`,
		`export class ${group} extends RpcGroup.make(`,
		`Rpc.make(${JSON.stringify(procedure.name)}, {`,
		`payload: ${procedure.payload},`,
		`success: ${procedure.success},`,
		`error: ${errorUnion},`,
		"}),",
		") {}",
		"",
	].join("\n");
}

function declare(
	definition: Definition,
	definitions: ReadonlyMap<string, Definition>,
): string {
	const { name, tag } = definition;
	const fields = fieldsOf(definition, definitions);
	if (tag !== undefined) {
		return [
			`export class ${name} extends Schema.TaggedError<${name}>()(${JSON.stringify(tag)}, {`,
			...fields,
			"}) {}",
			"",
		].join("\n");
	}
	return [
		`export const ${name} = Schema.Struct({`,
		...fields,
		"});",
		// An interface, not a type alias, so hovers say the name instead of
		// expanding the struct.
		`export interface ${name} extends Schema.Schema.Type<typeof ${name}> {}`,
		"",
	].join("\n");
}

function fieldsOf(
	definition: Definition,
	definitions: ReadonlyMap<string, Definition>,
): string[] {
	const properties = definition.schema.properties as Record<
		string,
		Record<string, unknown>
	>;
	const required = new Set(
		definition.schema.required as string[] | undefined,
	);
	return Object.entries(properties).flatMap(([field, schema]) => {
		if (definition.tag !== undefined && field === "_tag") return [];
		const code = fieldCode(schema, definitions);
		const doc = definition.docs.get(field);
		return [
			...(doc === undefined ? [] : jsDoc(doc)),
			`${field}: ${required.has(field) ? code : `Schema.optionalKey(${code})`},`,
		];
	});
}

function fieldCode(
	schema: Record<string, unknown>,
	definitions: ReadonlyMap<string, Definition>,
): string {
	const imported = SchemaRepresentation.fromJsonSchemaDocument({
		dialect: "draft-2020-12",
		schema,
		definitions: Object.fromEntries(
			[...definitions].map(([name, { schema }]) => [name, schema]),
		),
	});
	const code = SchemaRepresentation.toCodeDocument(
		SchemaRepresentation.toMultiDocument(
			SchemaRepresentation.toRepresentation(imported.ast),
		),
	);
	if (code.artifacts.length > 0) {
		throw new Error(`Unsupported field schema ${JSON.stringify(schema)}`);
	}
	const [root] = code.codes;
	if (root === undefined) throw new Error("The engine emitted no code");
	return mergeChecks(
		shorthands.reduce(
			(runtime, [spelledOut, shorthand]) =>
				typeof shorthand === "string"
					? runtime.replaceAll(spelledOut, shorthand)
					: runtime.replaceAll(spelledOut, shorthand),
			root.runtime,
		),
	);
}

// The engine spells out what a hand-written schema would name: a C++ int
// arrives as a check that is exactly Schema.Int.
//
// A string's minLength and maxLength (from rfl::Size) arrive as code point
// checks, annotated with the very `expected` text each check has by default.
// That annotation goes, and the check gets a message a person can read
// instead of "Expected a string with at least 5 code points". reflect-cpp's
// JSON Schema has no keyword for a message, so the wording lives here, once
// for every length bound.
const shorthands: ReadonlyArray<
	readonly [
		string | RegExp,
		string | ((match: string, ...groups: string[]) => string),
	]
> = [
	[
		'Schema.Number.check(Schema.isInt().annotate({ "expected": "an integer" }))',
		"Schema.Int",
	],
	[
		/Schema\.is(Min|Max)CodePoints\((\d+)\)\.annotate\(\{ "expected": "a string with at (?:least|most) \2 code points" \}\)/g,
		(_, bound = "", count = "") =>
			`Schema.is${bound}CodePoints(${count}, { message: ${JSON.stringify(
				`Must be at ${bound === "Min" ? "least" : "most"} ${count} characters long`,
			)} })`,
	],
];

/**
 * The engine chains one `.check(…)` per check; a hand-written schema passes
 * them to one call. Merges only calls that follow each other on the same
 * schema, skipping over parentheses inside string literals.
 */
function mergeChecks(runtime: string): string {
	const open = ".check(";
	let result = "";
	let index = 0;
	while (index < runtime.length) {
		const start = runtime.indexOf(open, index);
		if (start === -1) return result + runtime.slice(index);
		let end = closingParen(runtime, start + open.length);
		const args = [runtime.slice(start + open.length, end)];
		while (runtime.startsWith(open, end + 1)) {
			const next = end + 1 + open.length;
			end = closingParen(runtime, next);
			args.push(runtime.slice(next, end));
		}
		result += `${runtime.slice(index, start)}${open}${args.map(mergeChecks).join(", ")})`;
		index = end + 1;
	}
	return result;
}

/** The index of the `)` that closes the call whose arguments start at `from`. */
function closingParen(code: string, from: number): number {
	let depth = 0;
	for (let index = from; index < code.length; index++) {
		const char = code[index];
		if (char === '"') {
			while (++index < code.length && code[index] !== '"') {
				if (code[index] === "\\") index++;
			}
		} else if (char === "(") {
			depth++;
		} else if (char === ")") {
			if (depth === 0) return index;
			depth--;
		}
	}
	throw new Error(`Unbalanced parentheses in ${code}`);
}

/** Referenced structs before the structs that use them, roots in order. */
function dependencyOrder(
	roots: readonly string[],
	definitions: ReadonlyMap<string, Definition>,
): string[] {
	const ordered: string[] = [];
	const visit = (name: string) => {
		if (ordered.includes(name)) return;
		const refs = JSON.stringify(
			required(definitions, name).schema,
		).matchAll(/"#\/\$defs\/([^"]+)"/g);
		for (const [, ref] of refs) if (ref !== undefined) visit(ref);
		ordered.push(name);
	};
	for (const root of roots) visit(root);
	return ordered;
}

function required(
	definitions: ReadonlyMap<string, Definition>,
	name: string,
): Definition {
	const definition = definitions.get(name);
	if (definition === undefined) throw new Error(`No definition ${name}`);
	return definition;
}

function jsDoc(text: string): string[] {
	const lines = wrap(text.replaceAll("*/", "*\\/"), 72);
	return lines.length === 1
		? [`/** ${lines[0]} */`]
		: ["/**", ...lines.map((line) => ` * ${line}`), " */"];
}

function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/)) {
		if (line !== "" && line.length + word.length + 1 > width) {
			lines.push(line);
			line = word;
		} else {
			line = line === "" ? word : `${line} ${word}`;
		}
	}
	return [...lines, line];
}

function pascalCase(identifier: string): string {
	return identifier
		.split(/[_:]+/)
		.filter((part) => part !== "")
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join("");
}
