# Effect playground

A sandbox for learning Effect. Type a file name, pick a reader, submit, and
the file's contents come back, once over REST (`effect/http-api`) and once
over Effect RPC (`effect/rpc`). Files live in `files/`. A name that isn't
`.txt` fails with `NotTxtFile`; a missing `.txt` fails with `FileNotFound`.
A name must be 5 to 25 characters long. That rule lives on the C++ struct,
and everything else gets it from the generated schema (see below).

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

`bun run dev:server` runs the Bun server alone; there, the C++ endpoint and
procedure fail with `ReaderUnavailable`, as they do when the C++ process dies.

Each reader has its own endpoint and procedure, so only the C++ ones declare
`ReaderUnavailable`:

- REST: `GET /api/bun/files/:name` and `GET /api/cpp/files/:name`, called as
  `client.files.bun(…)` and `client.files.cpp(…)`.
- RPC: `ReadFileBun({ name })` and `ReadFileCpp({ name })`, both over
  `POST /rpc`.

## The reader protocol

The C++ structs in `cpp/include/reader_protocol.hpp` define what crosses the
wire between Bun and C++: the request, the success and the two errors.

1. reflect-cpp turns them into JSON Schema:
   `effect-playground-cpp --emit-schema` writes `cpp/protocol.schema.json`,
   adding each error's message template as `x-message`.
2. `scripts/generate.ts` turns that into Effect Schema in
   `src/shared/generated/`: one module per method, `read-file.ts`, and an
   index, `reader-protocol.ts`, that exports it as the namespace `ReadFile`
   next to the `ReaderProtocol` RPC group. `ReadFile.Request`,
   `ReadFile.Success` and `ReadFile.Error` are the payload, the success and
   the error union, and `ReadFile.NotTxtFile` and `ReadFile.FileNotFound` the
   `Schema.TaggedError` classes, each with a `message` getter. The module
   declares `ReadFileSuccess` and exports it as `Success`, so a hover still
   says `ReadFileSuccess`. A struct two methods share would have no module,
   so the generator fails on one.
3. Both readers fail with those error classes, and `src/shared/rest-api.ts`
   gives them their HTTP statuses.

Each error's sentence lives on its C++ struct, as
`static constexpr std::string_view message = "\"{file}\" is not a .txt file"`.
The generated class fills it in from its own fields in a `message` getter,
so `error.message` and `String(error)` read
`NotTxtFile: "config.json" is not a .txt file`, while the wire form stays
`{"_tag":"NotTxtFile","file":"config.json"}`. The C++ reader fills in the same
template for the `message` of its JSON-RPC error. The generator fails on an
error without a template, on a `{field}` the struct doesn't have, and on a
field named `name`, `message`, `stack` or `cause`, which would shadow the
`Error`'s own. `ReaderUnavailable` is the Bun server's, so its sentence lives
in `src/shared/reader-unavailable.ts`; the client's transport errors get their wording in
the client.

A field's reflect-cpp validators travel the same way. `ReadFileRequest::name`
is an `rfl::Validator` with two `rfl::Size` bounds, so the schema carries
`minLength: 5` and `maxLength: 25`, and the TS field is
`Schema.String.check(Schema.isMinCodePoints(5, …), Schema.isMaxCodePoints(25, …))`.
The generator writes each bound's message, because JSON Schema has no keyword
to carry one. A name out of bounds isn't a domain error, so there's no tagged
error for it. Each boundary rejects it:

- REST: `:name` is `ReadFile.Request.fields.name`, so HttpApi answers 400, and
  the REST client fails with a `SchemaError` before sending anything.
- RPC: the client can't encode the payload and dies before sending. A raw
  request gets an `Exit` whose cause is a `Die` with the schema's message.
- C++: reflect-cpp can't parse the params, and the reader answers with a `Die`.
- The page: each panel's react-hook-form validates against the same field, so
  it shows the message under the input and never sends the request.

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
- `src/shared/` is the contract both sides import: `ReaderUnavailable`, the
  REST API, the RPC group, and the generated reader protocol.
- `src/server/` holds `BunReader` and `CppReader`, and the two transports
  mounted on one router; each handler calls the reader its endpoint names.
- `src/client/` builds both clients, with one call per transport and reader
  (`rest.bun`, `rpc.cpp`, …). Each returns the contents, failing with exactly
  that call's errors. A panel runs one through `Effect.result` and renders
  the `Result`; on failure it shows `describeFailure`, which is the error's
  own `message` for the domain errors and the client's wording for transport
  errors. `App` builds the form schema from the generated `ReadFile.Request`
  plus `Reader`, and passes it to each panel, whose react-hook-form resolver
  uses it.
- `test/` holds the Bun tests and `clients.types.ts`, type-level checks that
  `bun run check` runs.
- `scripts/` builds the C++ and runs the code generator.

`@effect/platform-node-shared` is pinned to 4.0.0 only to match
`effect` 4.0.0. Its 4.1 release imports modules that effect 4.0 lacks.
