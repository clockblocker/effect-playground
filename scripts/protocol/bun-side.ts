import { join } from "node:path";
import { Glob } from "bun";
import { Schema } from "effect";
import type { BunOperation } from "./emit.ts";
import { normalizeEffect } from "./normalize.ts";

/**
 * Every operation the BFF serves itself: each `<operation>/<operation>-dtos.ts`
 * under `directory`, such as `read-file/read-file-dtos.ts` for ReadFile. A
 * module exports `Request` and `Success`, structs, `Errors`, the errors
 * besides InvalidRequest, each also exported by its name, and any other
 * struct they use.
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
		const dtos = join(directory, path);
		if (file !== `${folder}-dtos.ts`) {
			throw new Error(`${dtos} isn't named after its directory`);
		}
		const exported: Record<string, unknown> = await import(
			join(root, dtos)
		);
		const { Request, Success, Errors } = exported;
		if (!isStruct(Request) || !isStruct(Success)) {
			throw new Error(
				`${dtos} must export Request and Success, both structs`,
			);
		}
		if (!Array.isArray(Errors)) {
			throw new Error(`${dtos} must export Errors, a list of its errors`);
		}
		const nameOf = (value: unknown) => {
			const name = Object.keys(exported).find(
				(key) => key !== "Errors" && exported[key] === value,
			);
			if (name === undefined) {
				throw new Error(
					`${dtos} lists an error in Errors it doesn't export`,
				);
			}
			return name;
		};
		const errors = Errors.map(nameOf);
		operations.push({
			name: pascalCase(folder),
			dtos,
			request: normalizeEffect(
				Schema.toJsonSchemaDocument(Request),
				`${dtos}'s Request`,
			),
			sameStruct: Success === Request,
			structs: Object.keys(exported).filter(
				(key) =>
					!["Request", "Success", "Errors", ...errors].includes(
						key,
					) && isStruct(exported[key]),
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
