import { dirname, join, relative } from "node:path/posix";
import { SchemaRepresentation } from "effect";
import type { Definition, Procedure, Protocol } from "./normalize.ts";

/** Where the generated files come from and go, from the repository's root. */
export interface Origin {
	/** The header that lists the C++ operations, `cpp/domain/protocol.hpp`. */
	readonly cpp: string;
	/** The directory of each C++ operation's own header, `cpp/domain/protocol`. */
	readonly cppHeaders: string;
	/** The directory of the BFF operations, `src/server/bun-side`. */
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
 * An operation the BFF serves itself, whose DTOs are written by hand in its
 * source module: `Request`, `Success`, its errors and `Errors`. The emitter
 * writes them again from their JSON Schema, so that nothing in
 * `src/shared/` imports the BFF's own files.
 */
export interface BunOperation {
	readonly name: string;
	/** The DTOs' source module, from the repository's root. */
	readonly source: string;
	readonly request: Definition;
	/** `undefined` when `Success` is `Request`. */
	readonly success: Definition | undefined;
	readonly errors: readonly Definition[];
}

/** What an operation's DTOs and namespace are built from, whichever side declared it. */
interface Operation {
	readonly name: string;
	/** Its directory, such as `cpp-side/custom-cat`. */
	readonly directory: string;
	/** What its DTOs are generated from, from the repository's root. */
	readonly from: string;
	/** The definition of its request, `payload`, among `definitions`. */
	readonly payload: string;
	readonly definitions: ReadonlyMap<string, Definition>;
	/** Its DTOs' structs, in dependency order, each under its name there. */
	readonly structs: ReadonlyArray<{
		readonly definition: Definition;
		readonly name: string;
	}>;
	readonly sameStruct: boolean;
	readonly errors: readonly Definition[];
	/** Whether the C++ core serves it, in CoreRpcs. */
	readonly core: boolean;
}

/**
 * Writes a directory per operation under the side that serves it, such as
 * `cpp-side/custom-cat/`, and `generated.ts`, an index of the namespaces.
 *
 * In an operation's directory, `custom-cat-dtos.ts` is what it takes,
 * succeeds with and fails with, as its source declares them: `Request`,
 * `Success`, the structs they use under their own names, the errors besides
 * InvalidRequest, and `Errors`, a list of those. The source is a C++
 * operation's header, or a BFF operation's hand-written DTOs in
 * `Origin.bunSide`, which the DTOs repeat from their JSON Schema.
 * `custom-cat-namespace.ts` is what consumers use, a namespace named after
 * it: each of its DTOs with its type, then what the generator derives from
 * them, `RequestShape`, the request without its checks, and `Path`, where in
 * a request an issue can be, then what every operation builds alike from
 * those, with `Origin.helpers`: `Issue`, `InvalidRequest` and `Failure`.
 * Nothing is shared between operations: each declares every struct and
 * error it uses. `cpp-side/core-rpcs.ts` is `CoreRpcs`, the RPC group of the
 * C++ operations, which the BFF calls the core with.
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

	const operations: Operation[] = [];
	const errorsByName = new Map(
		protocol.errors.map((error) => [error.name, error]),
	);
	for (const procedure of protocol.procedures) {
		const errors = procedure.errors.map((name) =>
			required(errorsByName, name),
		);
		const names = dependencyOrder(
			[
				procedure.payload,
				procedure.success,
				...errors.flatMap((error) => refsOf(error)),
			],
			protocol.definitions,
		);
		checkNames(procedure, names, protocol.definitions);
		operations.push({
			name: procedure.name,
			directory: `cpp-side/${kebabCase(procedure.name)}`,
			from: `${origin.cppHeaders}/${snakeCase(procedure.name)}.hpp`,
			payload: procedure.payload,
			definitions: protocol.definitions,
			structs: names.map((name) => ({
				definition: required(protocol.definitions, name),
				name: roleOf(procedure, name),
			})),
			sameStruct: procedure.success === procedure.payload,
			errors,
			core: true,
		});
	}
	for (const operation of bunSide) {
		const { request, success } = operation;
		operations.push({
			name: operation.name,
			directory: `bun-side/${kebabCase(operation.name)}`,
			from: operation.source,
			payload: request.name,
			definitions: new Map([[request.name, request]]),
			structs: [
				{ definition: request, name: "Request" },
				...(success === undefined
					? []
					: [{ definition: success, name: "Success" }]),
			],
			sameStruct: success === undefined,
			errors: operation.errors,
			core: false,
		});
	}

	const files: File[] = [];
	const exports: string[] = [];
	for (const operation of operations) {
		for (const { name } of operation.errors) {
			if ((roleNames as readonly string[]).includes(name)) {
				throw new Error(
					`${name} would clash with ${operation.name}.${name}; rename the error`,
				);
			}
		}
		const base = `${operation.directory}/${kebabCase(operation.name)}`;
		const dtos = `${base}-dtos.ts`;
		const namespace = `${base}-namespace.ts`;
		const errorNames = operation.errors.map(({ name }) => name);
		files.push(
			module(
				dtos,
				operation.from,
				['import { Schema } from "effect";'],
				[
					...operation.structs.map(({ definition, name }) =>
						declare(definition, operation.definitions, name),
					),
					...(operation.sameStruct
						? ["export const Success = Request;", ""]
						: []),
					...operation.errors.map((error) =>
						errorDeclaration(error, operation.definitions),
					),
					`export const Errors = [${errorNames.join(", ")}] as const;`,
					"",
				],
			),
		);
		const fromHere = (target: string) =>
			relativeImport(join(origin.into, namespace), target);
		const link = (target: string, text = target) =>
			`[${text}](${fromHere(target)})`;
		files.push(
			module(
				namespace,
				join(origin.into, dtos),
				[
					'import { Schema } from "effect";',
					`import { failureOf, InvalidRequestOf, issueOf } from "${fromHere(origin.helpers)}";`,
					`import * as Dto from "${relativeImport(namespace, dtos)}";`,
				],
				[
					`/** ${link(join(origin.into, dtos), `${operation.name}'s DTOs`)}, generated from ${link(operation.from)} by ${link(origin.by)}. */`,
					operationNamespace(operation),
				],
			),
		);
		exports.push(
			`export { ${operation.name} } from "${relativeImport("generated.ts", namespace)}";`,
		);
	}
	const core = operations.filter((operation) => operation.core);
	if (core.length > 0) {
		const path = "cpp-side/core-rpcs.ts";
		files.push(
			module(
				path,
				origin.cpp,
				[
					'import { Rpc, RpcGroup } from "effect/rpc";',
					...core.map(
						({ name, directory }) =>
							`import { ${name} } from "${relativeImport(path, `${directory}/${kebabCase(name)}-namespace.ts`)}";`,
					),
				],
				[
					"/** The C++ core's operations, as the BFF calls them over JSON-RPC: each request by its shape alone, as the core checks its rules. */",
					"export class CoreRpcs extends RpcGroup.make(",
					...core.map(
						({ name }) =>
							`Rpc.make(${JSON.stringify(name)}, { payload: ${name}.RequestShape, success: ${name}.Success, error: ${name}.Failure }),`,
					),
					") {}",
					"",
				],
			),
		);
		exports.push(
			`export { CoreRpcs } from "${relativeImport("generated.ts", path)}";`,
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
		...operation.structs.flatMap(({ name }) => named(name, `Dto.${name}`)),
		...(operation.sameStruct
			? [
					"export const Success = Request;",
					"export interface Success extends Request {}",
					"",
				]
			: []),
		...operation.errors.flatMap(({ name }) => [
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
