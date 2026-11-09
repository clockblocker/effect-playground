// Run with `bun run deps`.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: "generated-through-its-index",
			severity: "error",
			comment:
				"Import the generated protocol from src/shared/generated/generated.ts: " +
				"the files behind it are the generator's to arrange, and only they " +
				"import each other.",
			from: { pathNot: "^src/shared/generated/" },
			to: {
				path: "^src/shared/generated/",
				pathNot: "^src/shared/generated/generated\\.ts$",
			},
		},
	],
	options: {
		// TypeScript 7 has no compiler API for dependency-cruiser to parse with.
		parser: "swc",
		doNotFollow: { path: "node_modules" },
		tsConfig: { fileName: "tsconfig.json" },
		enhancedResolveOptions: {
			extensions: [".ts", ".tsx", ".js"],
		},
	},
};
