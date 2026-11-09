import { dirname, join, relative } from "node:path/posix";
import { SchemaRepresentation } from "effect";
import type { Definition, Procedure, Protocol } from "./normalize.ts";

/** Where the generated files come from and go, from the repository's root. */
export interface Origin {
	/** The source, such as `cpp/include/protocol.hpp`. */
	readonly from: string;
	/** The generator, such as `scripts/generate.ts`. */
	readonly by: string;
	/** The directory the files go in, such as `src/shared/generated`. */
	readonly into: string;
}

/** A generated file, its path relative to `Origin.into`. */
export interface File {
	readonly path: string;
	readonly source: string;
}

/**
 * Writes the Effect Schema modules for a normalized protocol, in a directory
 * named after the C++ namespace, such as `protocol/`, and `generated.ts`, an
 * index that re-exports what they declare.
 *
 * Each procedure gets a TypeScript namespace of its own name, in a file of
 * its own under its side, such as `protocol/cpp-side/custom-cat.ts`. In it,
 * its payload is `Request`, `RequestShape` the same without its checks, and
 * its success `Success`; `Path` lists where in a request an issue can be,
 * `Issue` is a problem there, and `InvalidRequest` holds them. `Failure` is
 * `InvalidRequest` or one of its other errors, such as `IoFailed`, and
 * `Output` what it prints, the success tagged or a failure. Every other
 * definition only it uses keeps its own name. The errors besides
 * InvalidRequest are declared once, in `protocol/common/tagged-errors.ts`,
 * and a definition more than one procedure uses in
 * `protocol/common/definitions.ts`.
 *
 * Effect's own engine (`fromJsonSchemaDocument` → `toCodeDocument`) translates
 * each field's JSON Schema into a Schema expression. This emitter owns the
 * declarations around them, which that engine cannot express: `TaggedError`
 * classes and struct and type pairs.
 */
export function emit(protocol: Protocol, origin: Origin): readonly File[] {
	const { namespace, procedures, definitions, errors } = protocol;
	for (const { name } of errors) {
		if ((roleNames as readonly string[]).includes(name)) {
			throw new Error(
				`${name} would clash with the generated ${name}; rename the struct`,
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
	}
	// Each procedure's names are in dependency order, so their first
	// occurrences are too.
	const sharedNames = [...new Set(uses.flatMap(({ names }) => names))].filter(
		(name) => shared.has(name),
	);

	const directory = kebabCase(pascalCase(namespace || "protocol"));
	const definitionsFile = `${directory}/common/definitions.ts`;
	const errorsFile = `${directory}/common/tagged-errors.ts`;
	const comment = [
		"/*",
		"Generated",
		`- from: ${origin.from}`,
		`- by: ${origin.by}`,
		"*/",
	];
	/** A Markdown link to `target`, from the file at `path`. */
	const link = (path: string, target: string) =>
		`[${target}](${relative(dirname(join(origin.into, path)), target)})`;
	/** The file at `path`, which imports `names` from where they're declared. */
	const module = (
		path: string,
		imports: ReadonlyArray<
			readonly [file: string, names: readonly string[]]
		>,
		body: readonly string[],
	): File => ({
		path,
		source: [
			...comment,
			"",
			'import { Schema } from "effect";',
			...imports
				.filter(([, names]) => names.length > 0)
				.map(
					([file, names]) =>
						`import { ${names.join(", ")} } from "${relativeImport(path, file)}";`,
				),
			"",
			...body,
		].join("\n"),
	});
	const sharedIn = (names: readonly string[]) =>
		sharedNames.filter((name) => names.includes(name));

	const files: File[] = [];
	const exports: Array<readonly [file: string, names: readonly string[]]> =
		[];
	if (sharedNames.length > 0) {
		files.push(
			module(
				definitionsFile,
				[],
				sharedNames.map((name) =>
					declare(required(definitions, name), definitions),
				),
			),
		);
		exports.push([definitionsFile, sharedNames]);
	}
	if (errors.length > 0) {
		const names = errors.map(({ name }) => name);
		files.push(
			module(
				errorsFile,
				[
					[
						definitionsFile,
						sharedIn(errors.flatMap((error) => refsOf(error))),
					],
				],
				errors.map((error) => errorDeclaration(error, definitions)),
			),
		);
		exports.push([errorsFile, names]);
	}
	for (const { procedure, names } of uses) {
		const path = `${directory}/${kebabCase(procedure.side)}/${kebabCase(procedure.name)}.ts`;
		files.push(
			module(
				path,
				[
					[definitionsFile, sharedIn(names)],
					[errorsFile, procedure.errors],
				],
				[
					`/** Generated from ${link(path, origin.from)} by ${link(path, origin.by)}. */`,
					procedureNamespace(procedure, names, shared, protocol),
				],
			),
		);
		exports.push([path, [procedure.name]]);
	}
	files.push({
		path: "generated.ts",
		source: [
			...comment,
			"",
			...exports.map(
				([file, names]) =>
					`export { ${names.join(", ")} } from "${relativeImport("generated.ts", file)}";`,
			),
			"",
		].join("\n"),
	});
	return files;
}

/** How the file at `from` imports the one at `to`, both under the same root. */
function relativeImport(from: string, to: string): string {
	const path = relative(dirname(from), to);
	return path.startsWith(".") ? path : `./${path}`;
}

/** The names a procedure's namespace declares itself. */
const roleNames = [
	"Request",
	"RequestShape",
	"Success",
	"Path",
	"Issue",
	"InvalidRequest",
	"Failure",
	"Output",
] as const;

function procedureNamespace(
	procedure: Procedure,
	names: readonly string[],
	shared: ReadonlySet<string>,
	protocol: Protocol,
): string {
	const { definitions } = protocol;
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
	const roles = new Map([[payload, "Request"]]);
	if (success !== payload) roles.set(success, "Success");
	const declarations = names
		.filter((name) => !shared.has(name))
		.map((name) =>
			declare(required(definitions, name), definitions, roles.get(name)),
		);
	const sameStruct =
		success === payload
			? [
					"export const Success = Request;",
					"export interface Success extends Request {}",
					"",
				]
			: [];

	// First, as it fails on a struct that contains itself, which the shape
	// would inline forever.
	const path = pathDeclaration(procedure, definitions);
	return [
		`export namespace ${procedure.name} {`,
		...declarations,
		shapeDeclaration(procedure, definitions),
		...sameStruct,
		path,
		issueDeclaration,
		invalidRequestDeclaration,
		...(procedure.errors.length === 0
			? [
					"export const Failure = InvalidRequest;",
					"export type Failure = InvalidRequest;",
				]
			: [
					`export const Failure = Schema.Union([InvalidRequest, ${procedure.errors.join(", ")}]);`,
					`export type Failure = InvalidRequest | ${procedure.errors.join(" | ")};`,
				]),
		"",
		`export const Output = Schema.Union([Schema.TaggedStruct(${JSON.stringify(procedure.successTag)}, Success.fields), ${["InvalidRequest", ...procedure.errors].join(", ")}]);`,
		"export type Output = typeof Output.Type;",
		"}",
		"",
	].join("\n");
}

/** A `TaggedError` of its fields; a field `message` is its message. */
function errorDeclaration(
	definition: Definition,
	definitions: ReadonlyMap<string, Definition>,
): string {
	const { name, tag = name } = definition;
	const { _tag: _, ...properties } = definition.schema.properties as Record<
		string,
		unknown
	>;
	const fields = fieldsOf(
		{ ...definition, schema: { ...definition.schema, properties } },
		definitions,
	);
	return [
		`export class ${name} extends Schema.TaggedError<${name}>()(${JSON.stringify(tag)}, {`,
		...fields,
		"}) {}",
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
		`export const Path = Schema.Union([${tuples.join(", ")}]);`,
		"export type Path = typeof Path.Type;",
		"",
	].join("\n");
}

/** A procedure's Issue: Path is its own, so the struct is too. */
const issueDeclaration = [
	"export const Issue = Schema.Struct({",
	"message: Schema.String,",
	"path: Path,",
	"});",
	"export interface Issue extends Schema.Schema.Type<typeof Issue> {}",
	"",
].join("\n");

const invalidRequestDeclaration = [
	'export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {',
	"issues: Schema.NonEmptyArray(Issue),",
	"}) {",
	// A getter, not a field: the message never crosses the wire, and every
	// decoded instance still has it.
	"override get message(): string {",
	'return this.issues.map((issue) => issue.message).join("; ");',
	"}",
	"}",
	"",
].join("\n");

/**
 * Declares a definition under its own name, or, when `role` is set, under
 * the name its procedure's namespace gives it, such as `Request`.
 */
function declare(
	definition: Definition,
	definitions: ReadonlyMap<string, Definition>,
	role?: string,
): string {
	if (definition.tag !== undefined) {
		throw new Error(
			`${definition.name} is tagged, but only InvalidRequest can be`,
		);
	}
	const fields = fieldsOf(definition, definitions);
	const name = role ?? definition.name;
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
	shape = false,
): string[] {
	const properties = definition.schema.properties as Record<
		string,
		Record<string, unknown>
	>;
	const required = new Set(
		definition.schema.required as string[] | undefined,
	);
	return Object.entries(properties).flatMap(([field, schema]) => {
		const code = shape
			? withoutChecks(
					fieldCode(inlined(schema, definitions), definitions),
				)
			: fieldCode(schema, definitions);
		return [
			`${field}: ${required.has(field) ? code : `Schema.optionalKey(${code})`},`,
		];
	});
}

function fieldCode(
	schema: Record<string, unknown>,
	definitions: ReadonlyMap<string, Definition>,
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
			withoutExpected(
				SchemaRepresentation.toRepresentation(imported.ast),
			),
		),
	);
	if (code.artifacts.length > 0) {
		throw new Error(`Unsupported field schema ${JSON.stringify(schema)}`);
	}
	const [root] = code.codes;
	if (root === undefined) throw new Error("The engine emitted no code");
	return mergeChecks(root.runtime);
}

/**
 * Drops each check's `expected`, which the engine writes out as
 * `.annotate({ expected })` though it's the check's own default: the
 * importer ignores a JSON Schema's `expected`, so a check has no other.
 */
function withoutExpected<T>(representation: T): T {
	const strip = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(strip);
		if (typeof value !== "object" || value === null) return value;
		const entries = Object.entries(value).map(
			([key, item]) => [key, strip(item)] as const,
		);
		const node = Object.fromEntries(entries) as Record<string, unknown>;
		const annotations = node.annotations as
			| Record<string, unknown>
			| undefined;
		if (node._tag === "Filter" && annotations !== undefined) {
			const { expected: _, ...rest } = annotations;
			node.annotations = rest;
		}
		return node;
	};
	return strip(representation) as T;
}

/**
 * The request's fields with no checks, nested structs inlined: what a server
 * decodes when the C++ checks the rules, so that the issues are the C++'s.
 */
function shapeDeclaration(
	procedure: Procedure,
	definitions: ReadonlyMap<string, Definition>,
): string {
	return [
		"export const RequestShape = Schema.Struct({",
		...fieldsOf(
			required(definitions, procedure.payload),
			definitions,
			true,
		),
		"});",
		"export interface RequestShape extends Schema.Schema.Type<typeof RequestShape> {}",
		"",
	].join("\n");
}

/** A schema with every `$ref` replaced by the struct it names. */
function inlined(
	schema: Record<string, unknown>,
	definitions: ReadonlyMap<string, Definition>,
): Record<string, unknown> {
	const replace = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(replace);
		if (typeof value !== "object" || value === null) return value;
		const { $ref, ...rest } = value as Record<string, unknown>;
		if (typeof $ref === "string") {
			return replace(
				required(definitions, $ref.slice("#/$defs/".length)).schema,
			);
		}
		return Object.fromEntries(
			Object.entries(rest).map(([key, item]) => [key, replace(item)]),
		);
	};
	return replace(schema) as Record<string, unknown>;
}

/** Drops every `.check(…)` call: `Schema.String.check(…)` → `Schema.String`. */
function withoutChecks(runtime: string): string {
	const open = ".check(";
	const start = runtime.indexOf(open);
	if (start === -1) return runtime;
	const end = closingParen(runtime, start + open.length);
	return runtime.slice(0, start) + withoutChecks(runtime.slice(end + 1));
}

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
