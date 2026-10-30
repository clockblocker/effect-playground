# Effect playground

A sandbox for learning Effect. Type a file name, pick a reader, submit, and
the file's contents come back, once over REST (`effect/http-api`) and once
over Effect RPC (`effect/rpc`). Files live in `files/`. A name that isn't
`.txt` fails with `NotTxtFile`; a missing `.txt` fails with `FileNotFound`.

There are two readers: one in the Bun server, and one in C++ that the Bun
server calls over JSON-RPC.

## Prerequisites

Bun, plus a C++20 toolchain: CMake 3.24 or newer, Ninja and a recent Clang or
GCC. On macOS, `xcode-select --install` and `brew install cmake ninja`. The
first build fetches [reflect-cpp](https://github.com/getml/reflect-cpp)
v0.26.2 from GitHub, with the yyjson it bundles; nothing else is installed.

## Run

```sh
bun install
bun run dev
```

Open <http://127.0.0.1:5200/>. `bun run dev` builds `cpp/` if needed, then
runs the C++ launcher next to Vite. The launcher opens the C++ reader on an
ephemeral port on 127.0.0.1 (`EFFECT_PLAYGROUND_CPP_PORT` pins it), starts
`bun --watch src/server/main.ts` with that port in the same variable, and
forwards Ctrl-C to it. The Bun server listens on 5201 and Vite proxies `/api`
and `/rpc` to it. `EFFECT_PLAYGROUND_PORT` and `EFFECT_PLAYGROUND_SERVER_PORT`
move those.

If the launcher dies some other way, even by SIGKILL or a crash, a watchdog
process it forks at startup stops the Bun server within a second, `--watch`
included (see `cpp/src/watchdog.hpp`). SIGINT or SIGTERM to the launcher stop
everything too.

Stop `bun run dev` with Ctrl-C, which signals every process in it. `bun run`
doesn't forward SIGTERM to its children: `kill <pid of bun run dev>` leaves
the launcher, the Bun server and Vite running.

`bun run dev:server` runs the Bun server alone; there, `reader: "cpp"` fails
with `ReaderUnavailable`, as it does when the C++ process dies.

REST: `GET /api/files/:name?reader=bun|cpp`. RPC: `ReadFile({ name, reader })`.

## The reader protocol

The C++ structs in `cpp/include/reader_protocol.hpp` define what crosses the
wire between Bun and C++: the request, the success and the two errors.

1. reflect-cpp turns them into JSON Schema:
   `effect-playground-cpp --emit-schema` writes `cpp/protocol.schema.json`.
2. `scripts/generate.ts` turns that into Effect Schema in
   `src/shared/generated/reader-protocol.ts`: a `Schema.TaggedError` per error,
   a struct and type per message, and the `ReaderProtocol` RPC group.
3. Both readers fail with those error classes; `src/shared/errors.ts`
   re-exports them, and `src/shared/rest-api.ts` gives them their HTTP
   statuses.

After changing the structs, run `bun run generate`: it rebuilds the C++,
re-emits the schema and regenerates the TypeScript. Both outputs are
committed. `bun run generate:check` fails if either is stale.

The JSON-RPC dialect is Effect's `RpcSerialization.layerNdJsonRpc()`. The
C++ side of it is documented in `cpp/src/json_rpc.hpp`.

## Checks

```sh
bun run check            # tsc
bun run lint             # biome; bun run fix formats
bun run knip
bun run test             # builds and spawns the C++ reader
bun run generate:check
```

The C++ integration tests skip when `cmake` isn't on the PATH.

## Layout

- `cpp/` is the C++ launcher and reader. `cpp/build/` is ignored.
- `src/shared/` is the contract both sides import: the errors, the REST API,
  the RPC group, and the generated reader protocol.
- `src/server/` holds `FileReader`, which routes each request to `BunReader`
  or `CppReader`, and the two transports mounted on one router.
- `src/client/` builds both clients and maps each outcome to UI state.
- `scripts/` builds the C++ and runs the code generator.

`@effect/platform-node-shared` is pinned to 4.0.0 only to match
`effect` 4.0.0. Its 4.1 release imports modules that effect 4.0 lacks.
