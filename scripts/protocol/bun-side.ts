import { join } from "node:path";
import { Glob } from "bun";
import { Schema } from "effect";
import type { BunOperation } from "./emit.ts";
import { normalizeEffect } from "./normalize.ts";

/**
 * Every operation the BFF serves itself: each `<operation>/<operation>-dtos.ts`
 * under `directory`, such as `read-file/read-file-dtos.ts` for ReadFile. A
 * module exports `Request` and `Success`, structs, each of its errors besides
 * InvalidRequest, and `Errors`, a list of those, and nothing else. The
 * emitter writes them again, in `src/shared/generated/`, from their JSON
 * Schema, as it writes a C++ operation's.
 */
export async function loadBunSide(
	root: string,
	directory: string,
): Promise<BunOperation[]> {
	const paths = [
		...new Glob("*/*-dtos.ts").scanSync({ cwd: join(root, directory) }),
	].sort();
	const operations: BunOperation[] = [];
	for (const path of paths) {
		const [folder = "", file] = path.split("/");
		const source = join(directory, path);
		if (file !== `${folder}-dtos.ts`) {
			throw new Error(`${source} isn't named after its directory`);
		}
		const exported: Record<string, unknown> = await import(
			join(root, source)
		);
		const { Request, Success, Errors } = exported;
		if (!isStruct(Request) || !isStruct(Success)) {
			throw new Error(
				`${source} must export Request and Success, both structs`,
			);
		}
		if (!Array.isArray(Errors) || !Errors.every(Schema.isSchema)) {
			throw new Error(
				`${source} must export Errors, a list of its errors`,
			);
		}
		const errors = Errors.map((error) => {
			const name = Object.keys(exported).find(
				(key) => key !== "Errors" && exported[key] === error,
			);
			if (name === undefined) {
				throw new Error(
					`${source} lists an error in Errors it doesn't export`,
				);
			}
			const definition = normalizeEffect(
				Schema.toJsonSchemaDocument(error),
				name,
			);
			if (definition.tag === undefined) {
				throw new Error(`${source}'s ${name} must be a tagged error`);
			}
			return definition;
		});
		const known = [
			"Request",
			"Success",
			"Errors",
			...errors.map(({ name }) => name),
		];
		const others = Object.keys(exported).filter(
			(key) => !known.includes(key),
		);
		if (others.length > 0) {
			throw new Error(
				`${source} exports ${others.join(", ")}; it may export only ` +
					"Request, Success, its errors and Errors",
			);
		}
		operations.push({
			name: pascalCase(folder),
			source,
			request: normalizeEffect(
				Schema.toJsonSchemaDocument(Request),
				"Request",
			),
			success:
				Success === Request
					? undefined
					: normalizeEffect(
							Schema.toJsonSchemaDocument(Success),
							"Success",
						),
			errors,
		});
	}
	return operations;
}

const isStruct = (
	value: unknown,
): value is Schema.Struct<Schema.Struct.Fields> =>
	Schema.isSchema(value) && value.ast._tag === "Objects";

/** `read-file` → `ReadFile`. */
function pascalCase(kebab: string): string {
	return kebab
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}
