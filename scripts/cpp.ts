import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "cpp");
const build = join(source, "build");

/**
 * The C++ core, which serves the C++ operations over JSON-RPC and launches
 * the command after `--`, the BFF; see `cpp/server/main.cpp`.
 */
export const coreBinary = join(build, "core");

/** Prints the JSON Schema of `cpp/domain/protocol.hpp`. */
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
