import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "cpp");
const build = join(source, "build");

/** Copies one .txt file in `files/` to another; see `cpp/src/custom_cat.cpp`. */
export const customCatBinary = join(build, "custom_cat");

/** Prints the JSON Schema of `cpp/include/protocol.hpp`. */
export const protocolSchemaBinary = join(build, "protocol_schema");

/**
 * Configures the CMake project on first use, then builds it incrementally.
 * The first build fetches reflect-cpp from GitHub.
 */
export function buildCpp(): void {
	if (!existsSync(join(build, "build.ninja"))) {
		run(["cmake", "-S", source, "-B", build, "-G", "Ninja"]);
	}
	run(["cmake", "--build", build]);
}

function run(command: string[]) {
	const result = Bun.spawnSync(command, {
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	});
	if (result.exitCode !== 0) {
		throw new Error(`${command.join(" ")} exited with ${result.exitCode}`);
	}
}

if (import.meta.main) buildCpp();
