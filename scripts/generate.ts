// Runs the protocol pipeline: C++ structs → reflect-cpp → JSON Schema →
// Effect Schema TypeScript. With --check, writes nothing and fails if any
// committed artifact is stale, or if src/shared/generated/ holds a file, or
// a directory, the generator no longer writes.

import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { buildCpp, protocolSchemaBinary } from "./cpp.ts";
import { emit } from "./protocol/emit.ts";
import { normalize } from "./protocol/normalize.ts";

const root = join(import.meta.dir, "..");
const schemaPath = join(root, "cpp/protocol.schema.json");
// Paths from the repository's root.
const origin = {
	from: "cpp/include/protocol.hpp",
	by: "scripts/generate.ts",
	into: "src/shared/generated",
};
const generated = join(root, origin.into);
const check = process.argv.includes("--check");

buildCpp();
const emitted = Bun.spawnSync([protocolSchemaBinary], { stderr: "inherit" });
if (emitted.exitCode !== 0) throw new Error("protocol_schema failed");
const schema = emitted.stdout.toString();
const files = emit(normalize(JSON.parse(schema)), origin).map(
	({ path, source }) => {
		const file = join(generated, path);
		return [file, format(source, file)] as const;
	},
);

const artifacts: ReadonlyArray<readonly [string, string]> = [
	[schemaPath, schema],
	...files,
];
// Whatever under src/shared/generated/ isn't a file the generator writes or
// a directory that holds one, outermost first.
const leftovers = readdirSync(generated, {
	recursive: true,
	withFileTypes: true,
})
	.map((entry) => ({
		path: join(entry.parentPath, entry.name),
		directory: entry.isDirectory(),
	}))
	.filter(({ path, directory }) =>
		directory
			? !files.some(([file]) => file.startsWith(`${path}/`))
			: !files.some(([file]) => file === path),
	)
	.map(({ path }) => path)
	.filter(
		(path, _, all) => !all.some((other) => path.startsWith(`${other}/`)),
	);
if (check) {
	const stale = artifacts.filter(([path, text]) => read(path) !== text);
	for (const [path] of stale) {
		console.error(`${relative(root, path)} is stale; run bun run generate`);
	}
	for (const path of leftovers) {
		console.error(
			`${relative(root, path)} isn't generated anymore; run bun run generate`,
		);
	}
	process.exitCode = stale.length + leftovers.length > 0 ? 1 : 0;
} else {
	for (const path of leftovers) rmSync(path, { recursive: true });
	for (const [path, text] of artifacts) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	}
}

function format(source: string, path: string): string {
	const result = Bun.spawnSync(
		[
			join(root, "node_modules/.bin/biome"),
			"check",
			"--write",
			`--stdin-file-path=${path}`,
		],
		{ cwd: root, stdin: Buffer.from(source), stderr: "inherit" },
	);
	if (result.exitCode !== 0) throw new Error("biome could not format");
	return result.stdout.toString();
}

function read(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}
