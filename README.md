# Effect playground

A sandbox for learning Effect. Type a file name, submit, and the file's
contents come back over Effect RPC (`effect/rpc`). Files live in `files/`. A
name that isn't `.txt` fails with `NotTxtFile`; a missing `.txt` fails with
`FileNotFound`.
A name must be 5 to 25 characters long. That rule lives on a C++ struct, and
everything else gets it from the generated schema (see below).

The **BFF** (backend-for-frontend) is a Bun server; it serves the page over
RPC and also serves a REST API (`effect/http-api`) for other clients.

## Prerequisites

Bun, plus a C++20 toolchain for `bun run generate`: CMake 3.24 or newer,
Ninja and a recent Clang or GCC. On macOS, `xcode-select --install` and
`brew install cmake ninja`. The first build fetches
[reflect-cpp](https://github.com/getml/reflect-cpp) v0.26.2 from GitHub, with
the yyjson it bundles; nothing else is installed.

## Run

```sh
bun install
bun run dev
```

Open <http://127.0.0.1:5200/>. `bun run dev` runs the BFF as
`bun --watch src/server/main.ts` next to Vite. The BFF listens on 5201 and
Vite proxies `/rpc` to it; the REST API is at `http://127.0.0.1:5201/api/…`.
`EFFECT_PLAYGROUND_PORT` and `EFFECT_PLAYGROUND_SERVER_PORT` move those.

Stop `bun run dev` with Ctrl-C, which signals every process in it. `bun run`
doesn't forward SIGTERM to its children: `kill <pid of bun run dev>` leaves
the BFF and Vite running.

The read has one procedure and one endpoint:

- RPC, which the page uses: `ReadFile({ name })`, over `POST /rpc`.
- REST, for other clients: `GET /api/files/read/:name`. A client HttpApi
  derives from `BffApi` calls it as `client.files.read({ params: { name } })`.

## The protocol

The C++ structs in `cpp/include/protocol.hpp` define the request, the success
and the two errors.

1. reflect-cpp turns them into JSON Schema: `cpp/build/protocol_schema`
   writes `cpp/protocol.schema.json`, adding each error's message template
   as `x-message`.
2. `scripts/generate.ts` turns that into Effect Schema in one module,
   `src/shared/generated/protocol.ts`: a TypeScript namespace per method,
   named after it, such as `ReadFile`. `ReadFile.Request`, `ReadFile.Success`
   and `ReadFile.Failure` are the payload, the success and the error union
   (`Failure`, because an `Error` there would shadow the global one), and
   `ReadFile.NotTxtFile` and `ReadFile.FileNotFound` the `Schema.TaggedError`
   classes, each with a `message` getter. Each name is both the schema and
   its type, so `ReadFile.Success` works in either position, and TypeScript 7
   hovers read `ReadFile.Success`. A struct two methods share would have no
   namespace, so the generator fails on one.
3. `BffReader` fails with those error classes, and `src/shared/rest-api.ts`
   gives them their HTTP statuses.

Each error's sentence lives on its C++ struct, as
`static constexpr std::string_view message = "\"{file}\" is not a .txt file"`.
The generated class fills it in from its own fields in a `message` getter,
so `error.message` and `String(error)` read
`NotTxtFile: "config.json" is not a .txt file`, while the wire form stays
`{"_tag":"NotTxtFile","file":"config.json"}`. The generator fails on an
error without a template, on a `{field}` the struct doesn't have, and on a
field named `name`, `message`, `stack` or `cause`, which would shadow the
`Error`'s own. The client's transport errors get their wording in the client.

A field's reflect-cpp validators travel the same way. `ReadFileRequest::name`
is an `rfl::Validator` with two `rfl::Size` bounds, so the schema carries
`minLength: 5` and `maxLength: 25`, and the TS field is
`Schema.String.check(Schema.isMinCodePoints(5, …), Schema.isMaxCodePoints(25, …))`.
The generator writes each bound's message, because JSON Schema has no keyword
to carry one. A name out of bounds isn't a domain error, so there's no tagged
error for it. Each boundary rejects it:

- REST: `:name` is `ReadFile.Request.fields.name`, so HttpApi answers 400, and
  a client HttpApi derives fails with a `SchemaError` before sending anything.
- RPC: the client can't encode the payload and dies before sending. A raw
  request gets an `Exit` whose cause is a `Die` with the schema's message.
- The page: its react-hook-form validates against the same field, so
  it shows the message under the input and never sends the request.

After changing the structs, run `bun run generate`: it rebuilds the C++,
re-emits the schema and regenerates the TypeScript. Both outputs are
committed. `bun run generate:check` fails if either is stale, or if
`src/shared/generated/` holds a file the generator no longer writes.

## Checks

```sh
bun run check            # tsc
bun run lint             # biome; bun run fix formats
bun run knip
bun run test
bun run generate:check
```

## Layout

- `cpp/` holds the protocol's structs and the tool that emits their schema.
  `cpp/build/` is ignored.
- `src/shared/` is the contract the page and the BFF import: the REST API
  (`BffApi`), the RPC group (`BffRpcs`), and the generated protocol.
- `src/server/` is the BFF: `BffReader`, and the two transports mounted on
  one router.
- `src/client/` builds the RPC client as `AtomRpc` atoms (`effect/reactivity`),
  `BffRpcClient`, with the read as a mutation, `readFile`. It holds an
  `AsyncResult` of the success struct, failing with exactly the procedure's
  errors. The client's runtime is an atom too, so the protocol is built once,
  not per submit. `main.tsx` wraps the page in `@effect/atom-react`'s
  `RegistryProvider`, which holds the atoms. A submit runs the mutation and
  waits for it to settle, which keeps the button disabled meanwhile. On
  failure the page shows `describeFailure`, which is the error's own
  `message` for the domain errors and the client's wording for the transport
  error, and a generic message for a defect. `App` passes the generated
  `ReadFile.Request` to the panel as its form schema, which its
  react-hook-form resolver uses.
- `test/` holds the Bun tests.
- `scripts/` builds the C++ and runs the code generator.

`@effect/platform-node-shared` is pinned to 4.0.7 only to match
`effect` 4.0.7. `@effect/platform-bun` asks for `^4.0.7`, which would pull in
4.1, and 4.1 needs effect 4.1.
