import { expect, test } from "bun:test";
import { buildCpp } from "../scripts/cpp.ts";

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

test.skipIf(Bun.which("cmake") === null)(
	"a SIGKILLed launcher takes its child down with it",
	async () => {
		const launcher = Bun.spawn(
			[buildCpp(), "--", "sh", "-c", "echo $$; exec sleep 60"],
			{
				env: { ...process.env, EFFECT_PLAYGROUND_BACKEND_PORT: "" },
				stdin: "ignore",
				stdout: "pipe",
				stderr: "ignore",
			},
		);
		// The child's first line is its pid; `exec` keeps it for sleep.
		const { value } = await launcher.stdout.getReader().read();
		const child = Number(new TextDecoder().decode(value).trim());
		expect(child).toBeGreaterThan(0);
		expect(alive(child)).toBe(true);

		launcher.kill("SIGKILL");
		await launcher.exited;
		const deadline = Date.now() + 2_000;
		while (alive(child) && Date.now() < deadline) await Bun.sleep(50);
		expect(alive(child)).toBe(false);
	},
	600_000,
);
