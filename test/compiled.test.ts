import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCpp, coreBinary } from "../scripts/cpp.ts";

// What bun run build and bun run start make: the core, launching the BFF
// compiled into one executable, page included, both in the directory whose
// files/ they serve.

const directory = mkdtempSync(join(tmpdir(), "compiled-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test.skipIf(Bun.which("cmake") === null)(
	"the core launches the compiled BFF, which serves the page, its own operations and the core's",
	async () => {
		buildCpp();
		const bff = join(directory, "bff");
		const compiled = Bun.spawnSync(
			[
				"bun",
				"build",
				"--compile",
				join(import.meta.dir, "../src/server/main.ts"),
				"--outfile",
				bff,
			],
			{ stdout: "ignore", stderr: "pipe" },
		);
		expect(compiled.stderr.toString()).not.toContain("error");
		await Bun.write(join(directory, "files/hello.txt"), "Hello\n");

		const port = 5297;
		const core = Bun.spawn([coreBinary, "--", bff], {
			cwd: directory,
			env: { ...Bun.env, EFFECT_PLAYGROUND_PORT: String(port) },
			stdout: "ignore",
			stderr: "ignore",
		});
		try {
			const origin = `http://127.0.0.1:${port}`;
			let page = "";
			for (let tries = 0; tries < 100 && page === ""; tries++) {
				page = await fetch(origin)
					.then((response) => response.text())
					.catch(() => "");
				if (page === "") await Bun.sleep(50);
			}
			expect(page).toContain('<div id="root"></div>');
			const script = /src="([^"]+\.js)"/.exec(page)?.[1];
			expect((await fetch(`${origin}${script}`)).status).toBe(200);
			expect(
				await (
					await fetch(`${origin}/api/files/read/hello.txt`)
				).text(),
			).toBe("Hello\n");
			const counted = await fetch(`${origin}/api/files/count`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ file: "hello.txt" }),
			});
			expect(await counted.json()).toEqual({
				lines: 1,
				words: 1,
				bytes: 6,
			});
		} finally {
			core.kill("SIGINT");
			expect(await core.exited).not.toBe(-1);
		}
	},
	600_000,
);
