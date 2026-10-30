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
	return shorthands.reduce(
		(runtime, [spelledOut, shorthand]) =>
			runtime.replaceAll(spelledOut, shorthand),
		root.runtime,
	);
}

// The engine spells out what a hand-written schema would name: a C++ int
// arrives as a check that is exactly Schema.Int.
const shorthands: ReadonlyArray<readonly [string, string]> = [
	[
		'Schema.Number.check(Schema.isInt().annotate({ "expected": "an integer" }))',
		"Schema.Int",
	],
];

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
