import { dirname, join, relative } from "node:path/posix";
import { SchemaRepresentation } from "effect";
import type { Definition, Procedure, Protocol } from "./normalize.ts";

/** Where the generated files come from and go, from the repository's root. */
export interface Origin {
	/** The header that lists the C++ operations, `cpp/include/protocol.hpp`. */
	readonly cpp: string;
	/** The directory of each C++ operation's own header, `cpp/include/protocol`. */
	readonly cppHeaders: string;
	/** The directory of the bun-side operations' DTOs, `src/shared/bun-side`. */
	readonly bunSide: string;
	/** The generator, such as `scripts/generate.ts`. */
	readonly by: string;
	/** The directory the files go in, such as `src/shared/generated`. */
	readonly into: string;
	/** The module of what every namespace shares, `src/shared/helpers/procedure.ts`. */
	readonly helpers: string;
}

/** A generated file, its path relative to `Origin.into`. */
export interface File {
	readonly path: string;
	readonly source: string;
}

/**
 * An operation the BFF serves itself, whose DTOs are written by hand: a
 * module that exports `Request`, `Success`, the other structs they use, the
 * errors besides InvalidRequest, and `Errors`, a list of those.
 */
export interface BunOperation {
	readonly name: string;
	/** The DTOs' module, from the repository's root. */
	readonly dtos: string;
	/** `Request`, from Effect's JSON Schema of it. */
	readonly request: Definition;
	/** Whether `Success` is `Request`. */
	readonly sameStruct: boolean;
	/** The module's other structs, by the names it exports them under. */
	readonly structs: readonly string[];
	/** The module's errors, by the names it exports them under. */
	readonly errors: readonly string[];
}

/** What a namespace is built from, whichever side declared it. */
interface Operation {
	readonly name: string;
	/** Its directory, such as `cpp-side/custom-cat`. */
	readonly directory: string;
	/** What it's generated from, from the repository's root. */
	readonly from: string;
	/** Its DTOs' module, from the repository's root. */
	readonly dtos: string;
	/** The definition of its request, `payload`, among `definitions`. */
	readonly payload: string;
	readonly definitions: ReadonlyMap<string, Definition>;
	/** The DTOs' structs, under their names there: `Request` first. */
	readonly structs: readonly string[];
	readonly sameStruct: boolean;
	readonly errors: readonly string[];
	/** Its success's tag in what it prints, if it prints one. */
	readonly successTag: string | undefined;
}

/**
 * Writes a directory per operation under the side that serves it, such as
 * `cpp-side/custom-cat/`, and `generated.ts`, an index of the namespaces.
 *
 * In an operation's directory, `custom-cat-namespace.ts` is what consumers
 * use, a namespace named after it: each of its DTOs with its type, then what
 * the generator derives from them, `RequestShape`, the request without its
 * checks, and `Path`, where in a request an issue can be, then what every
 * operation builds alike from those, with `Origin.helpers`: `Issue`,
 * `InvalidRequest`, `Failure` and, for a C++ operation, `Output`, what it
 * prints. A C++ operation's DTOs are generated beside it, in
 * `custom-cat-dtos.ts`: what it takes, succeeds with and fails with, as C++
 * declares them, `Request`, `Success`, the structs they use under their own
 * names, the errors besides InvalidRequest, and `Errors`, a list of those. A
 * bun-side operation's are written by hand, in `Origin.bunSide`. Nothing is
 * shared between operations: each declares every struct and error it uses.
 *
 * Effect's own engine (`fromJsonSchemaDocument` → `toCodeDocument`) translates
 * each field's JSON Schema into a Schema expression. This emitter owns the
 * declarations around them, which that engine cannot express: `TaggedError`
 * classes and struct and type pairs.
 */
export function emit(
	protocol: Protocol,
	bunSide: readonly BunOperation[],
	origin: Origin,
): readonly File[] {
	const { definitions, errors } = protocol;
	const header = (from: string) => [
		"/*",
		"Generated",
		`- from: ${from}`,
		`- by: ${origin.by}`,
		"*/",
		"",
	];
	/** The file at `path`, generated from `from`: its imports, then its body. */
	const module = (
		path: string,
		from: string,
		imports: readonly string[],
		body: readonly string[],
	): File => ({
		path,
		source: [...header(from), ...imports, "", ...body].join("\n"),
	});

	const files: File[] = [];
	const operations: Operation[] = [];
	for (const procedure of protocol.procedures) {
		const procedureErrors = procedure.errors.map((name) =>
			required(new Map(errors.map((error) => [error.name, error])), name),
		);
		for (const { name } of procedureErrors) {
			if ((roleNames as readonly string[]).includes(name)) {
				throw new Error(
					`${name} would clash with the generated ${name}; rename the struct`,
				);
			}
		}
		const names = dependencyOrder(
			[
				procedure.payload,
				procedure.success,
				...procedureErrors.flatMap((error) => refsOf(error)),
			],
			definitions,
		);
		checkNames(procedure, names, definitions);
		const directory = `cpp-side/${kebabCase(procedure.name)}`;
		const dtos = `${directory}/${kebabCase(procedure.name)}-dtos.ts`;
		const from = `${origin.cppHeaders}/${snakeCase(procedure.name)}.hpp`;
		files.push(
			module(
				dtos,
				from,
				['import { Schema } from "effect";'],
				[
					...names.map((name) =>
						declare(
							required(definitions, name),
							definitions,
							roleOf(procedure, name),
						),
					),
					...(procedure.success === procedure.payload
						? ["export const Success = Request;", ""]
						: []),
					...procedureErrors.map((error) =>
						errorDeclaration(error, definitions),
					),
					`export const Errors = [${procedure.errors.join(", ")}] as const;`,
					"",
				],
			),
		);
		operations.push({
			name: procedure.name,
			directory,
			from,
			dtos: join(origin.into, dtos),
			payload: procedure.payload,
			definitions,
			structs: names.map((name) => roleOf(procedure, name)),
			sameStruct: procedure.success === procedure.payload,
			errors: procedure.errors,
			successTag: procedure.successTag,
		});
	}
	for (const operation of bunSide) {
		operations.push({
			name: operation.name,
			directory: `bun-side/${kebabCase(operation.name)}`,
			from: operation.dtos,
			dtos: operation.dtos,
			payload: operation.request.name,
			definitions: new Map([[operation.request.name, operation.request]]),
			structs: [
				"Request",
				...(operation.sameStruct ? [] : ["Success"]),
				...operation.structs,
			],
			sameStruct: operation.sameStruct,
			errors: operation.errors,
			successTag: undefined,
		});
	}

	const exports: string[] = [];
	for (const operation of operations) {
		const namespace = `${operation.directory}/${kebabCase(operation.name)}-namespace.ts`;
		const fromHere = (target: string) =>
			relativeImport(join(origin.into, namespace), target);
		const link = (target: string, text = target) =>
			`[${text}](${fromHere(target)})`;
		const source =
			operation.from === operation.dtos
				? ""
				: ` from ${link(operation.from)}`;
		files.push(
			module(
				namespace,
				operation.dtos,
				[
					'import { Schema } from "effect";',
					`import { failureOf, InvalidRequestOf, issueOf${operation.successTag === undefined ? "" : ", outputOf"} } from "${fromHere(origin.helpers)}";`,
					`import * as Dto from "${fromHere(operation.dtos)}";`,
				],
				[
					`/** ${link(operation.dtos, `${operation.name}'s DTOs`)}, generated${source} by ${link(origin.by)}. */`,
					operationNamespace(operation),
				],
			),
		);
		exports.push(
			`export { ${operation.name} } from "${relativeImport("generated.ts", namespace)}";`,
		);
	}
	files.push({
		path: "generated.ts",
		source: [
			...header(`${origin.cpp}, ${origin.bunSide}/`),
			...exports,
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
	"Errors",
] as const;

/** Fails on a struct the namespace couldn't name, or refer to by its name. */
function checkNames(
	procedure: Procedure,
	names: readonly string[],
	definitions: ReadonlyMap<string, Definition>,
): void {
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
		// The engine refers to a struct by its C++ name, which the DTOs don't
		// declare for the payload and success.
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
}

/** The name a procedure's DTOs and namespace give a struct it uses. */
function roleOf(procedure: Procedure, name: string): string {
	if (name === procedure.payload) return "Request";
	if (name === procedure.success) return "Success";
	return name;
}

/**
 * The namespace consumers use: each DTO with its type, so that hovers name
 * it, what the generator derives from them, and what the helpers build.
 */
function operationNamespace(operation: Operation): string {
	const named = (name: string, value: string) => [
		`export const ${name} = ${value};`,
		`export interface ${name} extends Schema.Schema.Type<typeof ${name}> {}`,
		"",
	];
	// First, as it fails on a struct that contains itself, which the shape
	// would inline forever.
	const path = pathDeclaration(operation);
	return [
		`export namespace ${operation.name} {`,
		...operation.structs.flatMap((name) => named(name, `Dto.${name}`)),
		...(operation.sameStruct
			? [
					"export const Success = Request;",
					"export interface Success extends Request {}",
					"",
				]
			: []),
		...operation.errors.flatMap((name) => [
			`export const ${name} = Dto.${name};`,
			`export type ${name} = Dto.${name};`,
			"",
		]),
		shapeDeclaration(operation),
		path,
		...named("Issue", "issueOf(Path)"),
		"export class InvalidRequest extends InvalidRequestOf<InvalidRequest>()(Issue) {}",
		"",
		"export const Failure = failureOf(InvalidRequest, Dto.Errors);",
		"export type Failure = typeof Failure.Type;",
		"",
		...(operation.successTag === undefined
			? []
			: [
					`export const Output = outputOf(${JSON.stringify(operation.successTag)}, Success, Failure);`,
					"export type Output = typeof Output.Type;",
				]),
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

function pathDeclaration(procedure: Operation): string {
	const { definitions } = procedure;
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
function shapeDeclaration(procedure: Operation): string {
	const { definitions } = procedure;
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

/** `AB` → `a_b`. */
function snakeCase(identifier: string): string {
	return kebabCase(identifier).replaceAll("-", "_");
}

/** `AB` → `a-b`. */
function kebabCase(identifier: string): string {
	return identifier.replaceAll(/(?<=.)([A-Z])/g, "-$1").toLowerCase();
}
