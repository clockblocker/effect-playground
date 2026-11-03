import { SchemaRepresentation } from "effect";
import {
	type Definition,
	type ErrorTemplate,
	type IssueTemplate,
	type Procedure,
	type Protocol,
	placeholder,
} from "./normalize.ts";

/**
 * Writes the Effect Schema module for a normalized protocol: one file named
 * after the C++ namespace, such as `protocol.ts`.
 *
 * Each procedure gets a TypeScript namespace of its own name. In it, its
 * payload is `Request` and its success `Success`; `Path` lists where in a
 * request an issue can be, `Issue` is a problem there, and `InvalidRequest`
 * holds them. `Failure` is `InvalidRequest` or one of its other errors,
 * such as `IoFailed`. Every other definition only it uses keeps its own
 * name. A definition more than one procedure uses is declared once, before
 * the namespaces, as are the rules' messages, and the errors besides
 * InvalidRequest.
 *
 * Effect's own engine (`fromJsonSchemaDocument` → `toCodeDocument`) translates
 * each field's JSON Schema into a Schema expression. This emitter owns the
 * declarations around them, which that engine cannot express: `TaggedError`
 * classes, struct and type pairs, and JSDoc from descriptions.
 */
export function emit(
	protocol: Protocol,
	header: readonly string[],
): { readonly file: string; readonly source: string } {
	const { namespace, procedures, definitions, issues, errors } = protocol;
	for (const { definition } of errors) {
		if (
			[...roleNames, ...topLevelNames].includes(
				definition.name as (typeof roleNames)[number],
			)
		) {
			throw new Error(
				`${definition.name} would clash with the generated ${definition.name}; rename the struct`,
			);
		}
	}

	const uses = procedures.map((procedure) => ({
		procedure,
		names: dependencyOrder(
			[procedure.payload, procedure.success],
			definitions,
		),
	}));
	const users = new Map<string, string[]>();
	for (const { procedure, names } of uses) {
		for (const name of names) {
			users.set(name, [...(users.get(name) ?? []), procedure.name]);
		}
	}
	const shared = new Set(
		[...users].filter(([, by]) => by.length > 1).map(([name]) => name),
	);
	for (const name of shared) {
		const by = users.get(name)?.join(" and ");
		const owner = procedures.find(
			({ payload, success }) => payload === name || success === name,
		);
		if (owner !== undefined) {
			throw new Error(
				`${name} is used by ${by}, but ${owner.name} declares it as ` +
					`${owner.payload === name ? "Request" : "Success"}; the ` +
					"generator can only share other definitions",
			);
		}
		if ((topLevelNames as readonly string[]).includes(name)) {
			throw new Error(
				`${name} would clash with the generated ${name}; rename the struct`,
			);
		}
	}
	// Each procedure's names are in dependency order, so their first
	// occurrences are too.
	const sharedNames = [...new Set(uses.flatMap(({ names }) => names))].filter(
		(name) => shared.has(name),
	);

	const source = [
		...header.map((line) => `// ${line}`),
		"//",
		...namespaceNote.map((line) => `// ${line}`),
		"",
		'import { Schema } from "effect";',
		"",
		issueDeclarations(issues),
		...sharedNames.map((name) =>
			declare(required(definitions, name), definitions, issues),
		),
		...errors.map((error) => errorDeclaration(error, definitions, issues)),
		...uses.map(({ procedure, names }) =>
			procedureNamespace(procedure, names, shared, protocol),
		),
	].join("\n");
	return {
		file: `${kebabCase(pascalCase(namespace || "protocol"))}.ts`,
		source,
	};
}

const namespaceNote = [
	"A namespace per method makes `ReadFile.Success` both the schema and its",
	"type, and TypeScript 7 hovers read `ReadFile.Success`. Namespaces are",
	"TypeScript-only syntax that emits code, which Bun and Vite both compile.",
	"What more than one method uses is declared once, before the namespaces.",
];

/** The names a procedure's namespace declares itself. */
const roleNames = [
	"Request",
	"Success",
	"Path",
	"Issue",
	"InvalidRequest",
	"Failure",
] as const;

/** The names declared before the namespaces, whatever the protocol. */
const topLevelNames = ["IssueMessage", "FieldOf", "fieldOf"] as const;

/**
 * `IssueMessage`, with a function per rule that fills in its template, and
 * `fieldOf`, which names an issue's field the way react-hook-form does.
 */
function issueDeclarations(issues: readonly IssueTemplate[]): string {
	const message = ({ name: rule, message }: IssueTemplate) => {
		const names = [
			...new Set(
				[...message.matchAll(placeholder)].map(([, name = ""]) => name),
			),
		];
		const parameter =
			names.length === 0
				? ""
				: `{ ${names.join(", ")} }: { ${names
						.map(
							(name) =>
								`readonly ${name}: ${name === "value" ? "string" : "number"}`,
						)
						.join("; ")} }`;
		const body =
			names.length === 0
				? JSON.stringify(message)
				: templateCode(message);
		return `${rule}: (${parameter}) => ${body},`;
	};
	return [
		"/** Each rule's message, from its C++ template, by the rule's name. */",
		"export const IssueMessage = {",
		...issues.map(message),
		"} as const;",
		"",
		fieldOfCode,
	].join("\n");
}

// The same for every protocol: react-hook-form names a field by its path.
const fieldOfCode = `type Segments = ReadonlyArray<string | number>;

/** The react-hook-form name of the field at a path: \`["files", 2, "input"]\` → \`"files.2.input"\`. */
export type FieldOf<P extends Segments> = P extends readonly [
	infer Head extends string | number,
	...infer Rest extends Segments,
]
	? Rest extends readonly []
		? \`\${Head}\`
		: \`\${Head}.\${FieldOf<Rest>}\`
	: never;

/** The react-hook-form name of the field an issue's path points at. */
export const fieldOf = <const P extends Segments>(path: P): FieldOf<P> =>
	path.join(".") as FieldOf<P>;
`;

function procedureNamespace(
	procedure: Procedure,
	names: readonly string[],
	shared: ReadonlySet<string>,
	protocol: Protocol,
): string {
	const { definitions, issues } = protocol;
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
	const declarations = names
		.filter((name) => !shared.has(name))
		.map((name) =>
			declare(
				required(definitions, name),
				definitions,
				issues,
				roles.get(name),
			),
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
		pathDeclaration(procedure, definitions),
		issueDeclaration(procedure, protocol.issue),
		invalidRequestDeclaration(procedure, protocol.invalidRequest),
		`/** What ${procedure.name} fails with. */`,
		...(procedure.errors.length === 0
			? [
					"export const Failure = InvalidRequest;",
					"export type Failure = InvalidRequest;",
				]
			: [
					`export const Failure = Schema.Union([InvalidRequest, ${procedure.errors.join(", ")}]);`,
					`export type Failure = InvalidRequest | ${procedure.errors.join(" | ")};`,
				]),
		"}",
		"",
	].join("\n");
}

/** A `TaggedError` whose message is its C++ template, over its fields. */
function errorDeclaration(
	{ definition, message }: ErrorTemplate,
	definitions: ReadonlyMap<string, Definition>,
	issues: readonly IssueTemplate[],
): string {
	const { name, tag = name } = definition;
	const { _tag: _, ...properties } = definition.schema.properties as Record<
		string,
		unknown
	>;
	const fields = fieldsOf(
		{ ...definition, schema: { ...definition.schema, properties } },
		definitions,
		issues,
	);
	return [
		...jsDoc(`An error that isn't about a field. Its message: ${message}`),
		`export class ${name} extends Schema.TaggedError<${name}>()(${JSON.stringify(tag)}, {`,
		...fields,
		"}) {",
		"override get message(): string {",
		`return ${templateCode(message, "this.")};`,
		"}",
		"}",
		"",
	].join("\n");
}

/** A field name, or `index` for any element of an array. */
type Segment = { readonly field: string } | "index";

/**
 * Every path from the payload to a field that holds a value: through a
 * struct's fields, and through an array's elements by index.
 */
function leafPaths(
	schema: Record<string, unknown>,
	definitions: ReadonlyMap<string, Definition>,
	seen: ReadonlySet<string> = new Set(),
): Segment[][] {
	const ref = schema.$ref;
	if (typeof ref === "string") {
		const name = ref.slice("#/$defs/".length);
		if (seen.has(name)) {
			throw new Error(`${name} contains itself, so its paths never end`);
		}
		const definition = required(definitions, name);
		if (definition.schema.type !== "object") return [[]];
		return leafPaths(
			definition.schema as Record<string, unknown>,
			definitions,
			new Set([...seen, name]),
		);
	}
	if (schema.type === "array" && typeof schema.items === "object") {
		return leafPaths(
			schema.items as Record<string, unknown>,
			definitions,
			seen,
		).map((path) => ["index", ...path]);
	}
	if (schema.type === "object" && typeof schema.properties === "object") {
		return Object.entries(
			schema.properties as Record<string, Record<string, unknown>>,
		).flatMap(([field, property]) =>
			leafPaths(property, definitions, seen).map((path) => [
				{ field },
				...path,
			]),
		);
	}
	return [[]];
}

function pathDeclaration(
	procedure: Procedure,
	definitions: ReadonlyMap<string, Definition>,
): string {
	const paths = leafPaths(
		{ $ref: `#/$defs/${procedure.payload}` },
		definitions,
	).filter((path) => path.length > 0);
	if (paths.length === 0) {
		throw new Error(
			`${procedure.payload} has no fields, so no issue has a path`,
		);
	}
	const tuples = [...paths, []].map(
		(path) =>
			`Schema.Tuple([${path
				.map((segment) =>
					segment === "index"
						? "Schema.Int"
						: `Schema.Literal(${JSON.stringify(segment.field)})`,
				)
				.join(", ")}])`,
	);
	return [
		`/** Where in a ${procedure.name} request an issue is: a field, or [] for the whole request. */`,
		`export const Path = Schema.Union([${tuples.join(", ")}]);`,
		"export type Path = typeof Path.Type;",
		"",
	].join("\n");
}

function issueDeclaration(procedure: Procedure, issue: Definition): string {
	const field = (name: string, code: string) => [
		...docOf(issue, name),
		`${name}: ${code},`,
	];
	return [
		`/** A problem with a ${procedure.name} request. */`,
		"export const Issue = Schema.Struct({",
		...field("message", "Schema.String"),
		...field("path", "Path"),
		"});",
		"export interface Issue extends Schema.Schema.Type<typeof Issue> {}",
		"",
	].join("\n");
}

function invalidRequestDeclaration(
	procedure: Procedure,
	invalidRequest: Definition,
): string {
	return [
		`/** What is wrong with a ${procedure.name} request's fields. */`,
		'export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {',
		...docOf(invalidRequest, "issues"),
		"issues: Schema.NonEmptyArray(Issue),",
		"}) {",
		// A getter, not a field: the message never crosses the wire, and
		// every decoded instance still has it.
		"override get message(): string {",
		'return this.issues.map((issue) => issue.message).join("; ");',
		"}",
		"}",
		"",
	].join("\n");
}

function docOf(definition: Definition, field: string): string[] {
	const doc = definition.docs.get(field);
	return doc === undefined ? [] : jsDoc(doc);
}

/**
 * Declares a definition under its own name, or, when `role` is set, under
 * the name its procedure's namespace gives it, such as `Request`, with JSDoc.
 */
function declare(
	definition: Definition,
	definitions: ReadonlyMap<string, Definition>,
	issues: readonly IssueTemplate[],
	role?: readonly [name: string, doc: string],
): string {
	if (definition.tag !== undefined) {
		throw new Error(
			`${definition.name} is tagged, but only InvalidRequest can be`,
		);
	}
	const fields = fieldsOf(definition, definitions, issues);
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

/** `"{value}" is not a .txt file` → a template literal over `value`. */
function templateCode(template: string, scope = ""): string {
	const parts = template.split(placeholder);
	const code = parts.map((part, index) =>
		index % 2 === 1
			? `\${${scope}${part}}`
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
	issues: readonly IssueTemplate[],
): string[] {
	const properties = definition.schema.properties as Record<
		string,
		Record<string, unknown>
	>;
	const required = new Set(
		definition.schema.required as string[] | undefined,
	);
	return Object.entries(properties).flatMap(([field, schema]) => {
		const code = fieldCode(schema, definitions, issues);
		return [
			...docOf(definition, field),
			`${field}: ${required.has(field) ? code : `Schema.optionalKey(${code})`},`,
		];
	});
}

function fieldCode(
	schema: Record<string, unknown>,
	definitions: ReadonlyMap<string, Definition>,
	issues: readonly IssueTemplate[],
): string {
	const imported = SchemaRepresentation.fromJsonSchemaDocument(
		{
			dialect: "draft-2020-12",
			schema,
			definitions: Object.fromEntries(
				[...definitions].map(([name, { schema }]) => [name, schema]),
			),
		},
		// The schema is our own, from the C++ rules.
		{ patterns: "apply" },
	);
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
		root.runtime
			.replaceAll(
				'Schema.Number.check(Schema.isInt().annotate({ "expected": "an integer" }))',
				"Schema.Int",
			)
			.replaceAll(lengthBound, (_, bound = "", limit = "") => {
				const keyword = bound === "Min" ? "minLength" : "maxLength";
				return `Schema.is${bound}CodePoints(${limit}, ${checkOptions(issues, keyword, limit)})`;
			})
			.replaceAll(
				patternCheck,
				(_, pattern = "") =>
					`Schema.isPattern(new RegExp(${pattern}, "u"), ${checkOptions(issues, "pattern")})`,
			),
	);
}

/** The message of the rule that carries `keyword`, filled in. */
function checkOptions(
	issues: readonly IssueTemplate[],
	keyword: string,
	limit?: string,
): string {
	const issue = issues.find((issue) => issue.keyword === keyword);
	if (issue === undefined) {
		throw new Error(`A field has a ${keyword}, but no rule carries one`);
	}
	const named = issue.message.includes("{limit}");
	return `{ message: IssueMessage.${issue.name}(${named ? `{ limit: ${limit} }` : ""}) }`;
}

// A string's minLength and maxLength (from a rule's rfl::Size) arrive as code
// point checks, annotated with the very `expected` text each check has by
// default. That annotation goes, and the check gets the message of the rule
// that carries the keyword, as the C++ side words it.
const lengthBound =
	/Schema\.is(Min|Max)CodePoints\((\d+)\)\.annotate\(\{ "expected": "a string with at (?:least|most) \2 code points" \}\)/g;

// The same for a pattern, from a rule's rfl::PatternValidator.
const patternCheck =
	/Schema\.isPattern\(new globalThis\.RegExp\(("(?:[^"\\]|\\.)*"), "u"\)\)\.annotate\(\{ "expected": "(?:[^"\\]|\\.)*" \}\)/g;

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

/** `AB` → `a-b`. */
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
