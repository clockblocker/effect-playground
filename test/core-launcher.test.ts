import { expect, test } from "bun:test";
import { buildCpp, coreBinary } from "../scripts/cpp.ts";

// The core as the parent process: it serves, launches its command with the
// port it serves on, and takes it down with it, however it dies.

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const launch = (command: string) => {
	buildCpp();
	return Bun.spawn([coreBinary, "--", "sh", "-c", command], {
		env: { ...Bun.env, EFFECT_PLAYGROUND_CORE_PORT: "" },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
};

test.skipIf(Bun.which("cmake") === null)(
	"launches its command with the port it serves on, and exits with its status",
	async () => {
		const core = launch("echo $EFFECT_PLAYGROUND_CORE_PORT; exit 7");
		const [stdout, stderr, code] = await Promise.all([
			new Response(core.stdout).text(),
			new Response(core.stderr).text(),
			core.exited,
		]);
		expect(code).toBe(7);
		expect(stderr).toContain(`127.0.0.1:${stdout.trim()}`);
	},
	600_000,
);

test.skipIf(Bun.which("cmake") === null)(
	"a SIGKILLed core takes its command down with it",
	async () => {
		const core = launch("echo $$; exec sleep 60");
		// The command's first line is its pid; `exec` keeps it for sleep.
		const { value } = await core.stdout.getReader().read();
		const child = Number(new TextDecoder().decode(value).trim());
		expect(alive(child)).toBe(true);

		core.kill("SIGKILL");
		await core.exited;
		const deadline = Date.now() + 2_000;
		while (alive(child) && Date.now() < deadline) await Bun.sleep(50);
		expect(alive(child)).toBe(false);
	},
	600_000,
);

test.skipIf(Bun.which("cmake") === null)(
	"refuses an argument it doesn't know",
	() => {
		buildCpp();
		const result = Bun.spawnSync([coreBinary, "--verbose"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.toString()).toContain(
			"usage: core [-- COMMAND...]",
		);
	},
	600_000,
);
