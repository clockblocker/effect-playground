// The C++ core as the tests run it: started without a command, so it only
// serves, in files/ under a directory of the test's own; and stand-ins for a
// core that's gone or misbehaves.

import { Effect, type Layer } from "effect";
import { buildCpp, coreBinary } from "../../scripts/cpp.ts";
import { Core } from "../../src/server/cpp-side/core.ts";

/** The port in the core's first line, `core: serving … on 127.0.0.1:PORT`. */
async function listeningPort(stderr: ReadableStream<Uint8Array>) {
	const decoder = new TextDecoder();
	let output = "";
	for await (const chunk of stderr) {
		output += decoder.decode(chunk, { stream: true });
		const match = /127\.0\.0\.1:(\d+)/.exec(output);
		if (match?.[1] !== undefined) return Number(match[1]);
	}
	throw new Error(`The core exited: ${output}`);
}

/** Builds the core and starts it in `directory`. */
export async function startCore(directory: string) {
	buildCpp();
	const process = Bun.spawn([coreBinary], {
		cwd: directory,
		env: { ...Bun.env, EFFECT_PLAYGROUND_CORE_PORT: "" },
		stdin: "ignore",
		stdout: "ignore",
		stderr: "pipe",
	});
	const port = await listeningPort(process.stderr);
	return {
		port,
		layer: Core.connect(port),
		stop: async () => {
			process.kill();
			await process.exited;
		},
	};
}

/** A port nothing listens on. */
export function closedPort() {
	const server = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: { data() {} },
	});
	const { port } = server;
	server.stop(true);
	return port;
}

/**
 * A stand-in core on its own port, which answers each request, a parsed
 * JSON-RPC frame with an id, with the line `answer` gives, or not at all.
 */
export function fakeCore(
	answer: (request: { readonly id: unknown }) => object | undefined,
) {
	let buffer = "";
	const server = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: {
			data(socket, data) {
				buffer += new TextDecoder().decode(data);
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const frame = JSON.parse(line);
					if (frame.id === undefined) continue;
					const response = answer(frame);
					if (response !== undefined) {
						socket.write(`${JSON.stringify(response)}\n`);
					}
				}
			},
		},
	});
	return { port: server.port, stop: () => server.stop(true) };
}

/** Runs `effect` with `layer`, as a Result. */
export const runWith = <A, E>(
	layer: Layer.Layer<Core>,
	effect: Effect.Effect<A, E, Core>,
) => Effect.runPromise(effect.pipe(Effect.result, Effect.provide(layer)));
