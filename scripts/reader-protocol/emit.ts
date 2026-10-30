import { SchemaRepresentation } from "effect";
import {
	type Definition,
	type Procedure,
	type Protocol,
	placeholder,
} from "./normalize.ts";

/**
 * Writes the Effect Schema module for a normalized protocol: one file named
 * after the C++ namespace, such as `reader-protocol.ts`.
 *
 * Each procedure gets a TypeScript namespace of its own name, the one its RPC
 * is made with. In it, its payload is `Request`, its success `Success` and
 * its error union `Failure`, and every other definition it uses, such as its
 * error classes, keeps its own name. After the namespaces comes the RPC group.
 *
 * Effect's own engine (`fromJsonSchemaDocument` → `toCodeDocument`) translates
 * each field's JSON Schema into a Schema expression. This emitter owns the
 * declarations around them, which that engine cannot express: `TaggedError`
 * classes, struct and type pairs, JSDoc from descriptions, and the RPC group.
 */
export function emit(
	protocol: Protocol,
	header: readonly string[],
): { readonly file: string; readonly source: string } {
	const { namespace, procedures, definitions } = protocol;
	const group = pascalCase(namespace || "Protocol");

	// A definition lives in the namespace of the one procedure that uses it.
	const owners = new Map<string, string>();
	const namespaces = procedures.map((procedure) => {
		if (procedure.name === group) {
			throw new Error(
				`${procedure.name} would clash with the RPC group ${group}; ` +
					"rename the procedure or the C++ namespace",
			);
		}
		const names = dependencyOrder(
			[procedure.payload, procedure.success, ...procedure.errors],
			definitions,
		);
		for (const name of names) {
			const owner = owners.get(name);
			if (owner !== undefined) {
				throw new Error(
					`${name} is used by both ${owner} and ${procedure.name}, and ` +
						"the generator has no module for shared definitions yet",
				);
			}
			owners.set(name, procedure.name);
		}
		return procedureNamespace(procedure, names, definitions);
	});

	const source = [
		...header.map((line) => `// ${line}`),
		"//",
		...namespaceNote.map((line) => `// ${line}`),
		"",
		'import { Schema } from "effect";',
		'import { Rpc, RpcGroup } from "effect/rpc";',
		"",
		...namespaces,
		`/** The C++ reader's procedures, for an Effect RPC client over JSON-RPC. */`,
		`export class ${group} extends RpcGroup.make(`,
		...procedures.map(({ name }) =>
			[
				`Rpc.make(${JSON.stringify(name)}, {`,
				`payload: ${name}.Request,`,
				`success: ${name}.Success,`,
				`error: ${name}.Failure,`,
				"}),",
			].join("\n"),
		),
		") {}",
		"",
	].join("\n");
	return { file: `${kebabCase(group)}.ts`, source };
}

const namespaceNote = [
	"A namespace per method makes `ReadFile.Success` both the schema and its",
	"type, and TypeScript 7 hovers read `ReadFile.Success`. Namespaces are",
	"TypeScript-only syntax that emits code, which Bun and Vite both compile.",
];

/** The names a procedure's namespace gives its payload, success and errors. */
const roleNames = ["Request", "Success", "Failure"] as const;

function procedureNamespace(
	procedure: Procedure,
	names: readonly string[],
	definitions: ReadonlyMap<string, Definition>,
): string {
	const { payload, success } = procedure;
	for (const name of names) {
		if (
			name !== payload &&
			name !== success &&
			(roleNames as readonly string[]).includes(name)
		) {
			throw new Error(
				`${name} would clash with ${procedure.name}.${name}; rename the struct`,
			);
		}
		// The engine refers to a struct by its C++ name, which the namespace
		// doesn't declare for the payload and success.
		for (const ref of refsOf(required(definitions, name))) {
			if (ref === payload || ref === success) {
				throw new Error(
					`${name} refers to ${ref}, which ${procedure.name} declares ` +
						`as ${ref === payload ? "Request" : "Success"}; the ` +
						"generator can't refer to it by that name yet",
				);
			}
		}
	}
	const roles = new Map<string, readonly [string, string]>([
		[payload, ["Request", `What ${procedure.name} takes.`]],
	]);
	if (success !== payload) {
		roles.set(success, [
			"Success",
			`What ${procedure.name} succeeds with.`,
		]);
	}
	const declarations = names.map((name) =>
		declare(required(definitions, name), definitions, roles.get(name)),
	);
	const sameStruct =
		success === payload
			? [
					`/** What ${procedure.name} succeeds with, the same struct it takes. */`,
					"export const Success = Request;",
					"export interface Success extends Request {}",
					"",
				]
			: [];

	return [
		`/** What the ${procedure.name} method takes, succeeds with and fails with. */`,
		`export namespace ${procedure.name} {`,
		...declarations,
		...sameStruct,
		`/** Every error ${procedure.name} can fail with. */`,
		`export const Failure = Schema.Union([${procedure.errors.join(", ")}]);`,
		"export type Failure = typeof Failure.Type;",
		"}",
		"",
	].join("\n");
}

/**
 * Declares a definition under its own name, or, when `role` is set, under
 * the name its procedure's namespace gives it, such as `Request`, with JSDoc.
 */
function declare(
	definition: Definition,
	definitions: ReadonlyMap<string, Definition>,
	role?: readonly [name: string, doc: string],
): string {
	const { tag } = definition;
	const fields = fieldsOf(definition, definitions);
	if (tag !== undefined) {
		const { name } = definition;
		if (definition.message === undefined) {
			throw new Error(`${name} is tagged but has no message template`);
		}
		if (role !== undefined) {
			throw new Error(
				`${name} is an error, so it can't be a payload or success`,
			);
		}
		return [
			`export class ${name} extends Schema.TaggedError<${name}>()(${JSON.stringify(tag)}, {`,
			...fields,
			"}) {",
			// A getter, not a field: the message never crosses the wire, and
			// every decoded instance still has it.
			"override get message(): string {",
			`return ${messageCode(definition.message)};`,
			"}",
			"}",
			"",
		].join("\n");
	}
	const [name, doc] = role ?? [definition.name];
	return [
		...(doc === undefined ? [] : [`/** ${doc} */`]),
		`export const ${name} = Schema.Struct({`,
		...fields,
		"});",
		// An interface, not a type alias, so hovers say the name instead of
		// expanding the struct.
		`export interface ${name} extends Schema.Schema.Type<typeof ${name}> {}`,
		"",
	].join("\n");
}

/** `"{file}" is not a .txt file` → a template literal over `this.file`. */
function messageCode(template: string): string {
	const parts = template.split(placeholder);
	const code = parts.map((part, index) =>
		index % 2 === 1
			? `\${this.${part}}`
			: part
					.replaceAll("\\", "\\\\")
					.replaceAll("`", "\\`")
					.replaceAll("${", "\\${"),
	);
	return `\`${code.join("")}\``;
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
		for (const ref of refsOf(required(definitions, name))) visit(ref);
		ordered.push(name);
	};
	for (const root of roots) visit(root);
	return ordered;
}

/** The definitions a definition's schema refers to, by name. */
function refsOf(definition: Definition): string[] {
	return [
		...JSON.stringify(definition.schema).matchAll(/"#\/\$defs\/([^"]+)"/g),
	].flatMap(([, ref]) => (ref === undefined ? [] : [ref]));
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

/** `ReaderProtocol` → `reader-protocol`. */
function kebabCase(identifier: string): string {
	return identifier.replaceAll(/(?<=.)([A-Z])/g, "-$1").toLowerCase();
}

function pascalCase(identifier: string): string {
	return identifier
		.split(/[_:]+/)
		.filter((part) => part !== "")
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join("");
}
