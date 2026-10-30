import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "cpp");
const build = join(source, "build");

/** The launcher and C++ reader, once {@link buildCpp} has built it. */
export const cppBinary = join(build, "effect-playground-cpp");

/**
 * Configures the CMake project on first use, then builds it incrementally.
 * The first build fetches reflect-cpp from GitHub.
 */
export function buildCpp(): string {
	if (!existsSync(join(build, "build.ninja"))) {
		run(["cmake", "-S", source, "-B", build, "-G", "Ninja"]);
	}
	run(["cmake", "--build", build]);
	return cppBinary;
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
