# Effect playground

A sandbox for learning Effect. The page has two forms, and both talk to the
BFF over Effect RPC (`effect/rpc`). In the first, type a file name, submit,
and the file's contents come back. In the second, type an input and an
output file, and `custom_cat` copies one to the other. Files live in
`files/`. A name that isn't `.txt` fails with `NotTxtFile`; a missing input
fails with `FileNotFound`.
A name must be 5 to 25 characters long. That rule lives on a C++ struct, and
everything else gets it from the generated schema (see below).

The **BFF** (backend-for-frontend) is a Bun server; it serves the page over
RPC, a REST API (`effect/http-api`) for other clients, and an MCP server
(`effect/ai`) whose one tool, `custom_cat`, runs the C++ executable of that
name, which copies one `.txt` file to another.

## Prerequisites

Bun, plus a C++20 toolchain: CMake 3.24 or newer,
Ninja and a recent Clang or GCC. On macOS, `xcode-select --install` and
`brew install cmake ninja`. The first build fetches
[reflect-cpp](https://github.com/getml/reflect-cpp) v0.26.2 from GitHub, with
the yyjson it bundles; nothing else is installed.

## Run

```sh
bun install
bun run dev
```

Open <http://127.0.0.1:5200/>. `bun run dev` builds `cpp/` if needed, then
runs the BFF as `bun --watch src/server/main.ts` next to Vite. The BFF
listens on 5201 and Vite proxies `/rpc` to it; the REST API is at
`http://127.0.0.1:5201/api/…` and the MCP server at
`http://127.0.0.1:5201/mcp`, which Vite doesn't proxy.
`EFFECT_PLAYGROUND_PORT` and `EFFECT_PLAYGROUND_SERVER_PORT` move those.

Stop `bun run dev` with Ctrl-C, which signals every process in it. `bun run`
doesn't forward SIGTERM to its children: `kill <pid of bun run dev>` leaves
the BFF and Vite running.

What each transport serves:

- RPC, which the page uses: `ReadFile({ name })` and
  `CustomCat({ inputFile, outputFile })`, both over `POST /rpc`.
- REST, for other clients: `GET /api/files/read/:name`. A client HttpApi
  derives from `BffApi` calls it as `client.files.read({ params: { name } })`.
- MCP, for MCP clients: the `custom_cat` tool, over Streamable HTTP at
  `/mcp`, protocol 2025-11-25 or 2025-06-18. Its parameters are
  `CustomCat.Request`; a `NotTxtFile` or `FileNotFound` comes back as a tool
  error whose text is the error's `message`.

For example, after `initialize` (whose response carries `mcp-session-id`)
and `notifications/initialized`:

```sh
curl http://127.0.0.1:5201/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $session" -H 'mcp-protocol-version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"custom_cat","arguments":{"inputFile":"hello.txt","outputFile":"copy.txt"}}}'
```

copies `files/hello.txt` to `files/copy.txt`, and its JSON-RPC `result` is
`{"content":[{"type":"text","text":"{\"bytesCopied\":54}"}],"structuredContent":{"bytesCopied":54},"isError":false}`.

## `custom_cat`

`cpp/build/custom_cat` is a C++ executable that copies one `.txt` file in
`files/` to another, replacing the output if it exists. `files/` is under its
working directory, and only each name's base name is used.

```sh
custom_cat --input-file=hello.txt --output-file=copy.txt
```

Its flags are the fields of `CustomCatRequest`, which reflect-cpp's CLI
reader (`rfl/cli.hpp`) spells in kebab-case; an unknown flag is an error. It
follows the read's rules: both names are 5 to 25 characters, each must be
`.txt` (else `NotTxtFile` with that name), and the input must exist (else
`FileNotFound`). What it prints, and its exit codes:

- 0, copied: stdout is `{"bytesCopied":18}`.
- 1, `NotTxtFile` or `FileNotFound`: stdout is the tagged error, such as
  `{"_tag":"NotTxtFile","file":"a.json"}`, and stderr its message,
  `custom_cat: "a.json" is not a .txt file`.
- 2, a bad argument, such as a missing flag or a name out of bounds:
  reflect-cpp's error, on stderr.
- 3, anything else, such as a directory named `x.txt`: on stderr.

stdout is JSON in the generated schemas' wire form: `CustomCat.Success` on
0, `CustomCat.Failure` on 1. The message on stderr is the error's template
from the C++ struct, filled in. The BFF's `CustomCatCli` runs it with Effect's
`ChildProcess` and decodes stdout with those schemas, into a success or a
typed failure; any other exit, or output that doesn't decode, is a defect.

## The protocol

The C++ structs in `cpp/include/protocol.hpp` define each procedure's
request, success and errors: `ReadFile`, which `BffReader` serves, and
`CustomCat`, which `custom_cat` runs. `Procedures` lists them. Fields are
snake_case in C++ and camelCase in JSON, through reflect-cpp's
`SnakeCaseToCamelCase` (`protocol::Wire`).

1. reflect-cpp turns them into JSON Schema: `cpp/build/protocol_schema`
   writes `cpp/protocol.schema.json`, adding each error's message template
   as `x-message`.
2. `scripts/generate.ts` turns that into Effect Schema in one module,
   `src/shared/generated/protocol.ts`: a TypeScript namespace per method,
   named after it, such as `ReadFile`. `ReadFile.Request`, `ReadFile.Success`
   and `ReadFile.Failure` are the payload, the success and the error union
   (`Failure`, because an `Error` there would shadow the global one). Each
   name is both the schema and its type, so `ReadFile.Success` works in
   either position, and TypeScript 7 hovers read `ReadFile.Success`.
   `NotTxtFile` and `FileNotFound`, which both methods fail with, are
   declared once, before the namespaces, as `Schema.TaggedError` classes,
   each with a `message` getter; both `Failure` unions refer to them. An
   error only one method has would live in its namespace. The generator
   fails on a payload or success two methods share, which would need two
   names.
3. `BffReader` fails with those error classes, and `src/shared/rest-api.ts`
   gives them their HTTP statuses.

Each error's sentence lives on its C++ struct, as
`static constexpr std::string_view message = "\"{file}\" is not a .txt file"`.
The generated class fills it in from its own fields in a `message` getter,
so `error.message` and `String(error)` read
`NotTxtFile: "config.json" is not a .txt file`, while the wire form stays
`{"_tag":"NotTxtFile","file":"config.json"}`. `custom_cat` fills in the
same template for its stderr. The generator fails on an
error without a template, on a `{field}` the struct doesn't have, and on a
field named `name`, `message`, `stack` or `cause`, which would shadow the
`Error`'s own. The client's transport errors get their wording in the client.

A field's reflect-cpp validators travel the same way. Every file name is a
`protocol::FileName`, an `rfl::Validator` with two `rfl::Size` bounds, so the
schema carries
`minLength: 5` and `maxLength: 25`, and the TS field is
`Schema.String.check(Schema.isMinCodePoints(5, …), Schema.isMaxCodePoints(25, …))`.
The generator writes each bound's message, because JSON Schema has no keyword
to carry one. A name out of bounds isn't a domain error, so there's no tagged
error for it. Each boundary rejects it:

- REST: `:name` is `ReadFile.Request.fields.name`, so HttpApi answers 400, and
  a client HttpApi derives fails with a `SchemaError` before sending anything.
- RPC: the client can't encode the payload and dies before sending. A raw
  request gets an `Exit` whose cause is a `Die` with the schema's message.
- The page: each form's react-hook-form validates against the same field,
  so it shows the message under that input and never sends the request.
- MCP: the tool's parameters don't decode, so the call is a tool error.
- `custom_cat`: reflect-cpp rejects the flag, and it exits with 2.

After changing the structs, run `bun run generate`: it rebuilds the C++,
re-emits the schema and regenerates the TypeScript. Both outputs are
committed. `bun run generate:check` fails if either is stale, or if
`src/shared/generated/` holds a file the generator no longer writes.

## Checks

```sh
bun run check            # tsc
bun run lint             # biome; bun run fix formats
bun run knip
bun run test             # builds the C++; runs custom_cat and the MCP server
bun run generate:check
```

The tests that run `custom_cat` skip when `cmake` isn't on the PATH.

## Layout

- `cpp/` holds the protocol's structs, `custom_cat` and the tool that emits
  the schema. `cpp/build/` is ignored.
- `src/shared/` is the contract the page and the BFF import: the REST API
  (`BffApi`), the RPC group (`BffRpcs`), and the generated protocol.
- `src/server/` is the BFF: `BffReader` and `CustomCatCli`, and the three
  transports mounted on one router.
- `src/client/` builds the RPC client as `AtomRpc` atoms (`effect/reactivity`),
  `BffRpcClient`. The client's runtime is an atom too, so the protocol is
  built once, not per submit. `main.tsx` wraps the page in
  `@effect/atom-react`'s `RegistryProvider`, which holds the atoms.
  `App` renders two forms, `forms/read-file.tsx` (`ReadFileForm`) and
  `forms/run-cli.tsx` (`RunCliForm`), and passes each its schema, the
  generated `ReadFile.Request` or `CustomCat.Request`, which its
  react-hook-form resolver uses. Each runs its procedure as a mutation, which
  holds an `AsyncResult` of the success struct, failing with exactly the
  procedure's errors. A submit runs the mutation and waits for it to settle,
  which keeps the button disabled meanwhile. `forms/shared.tsx` holds what
  both use: the resolver hook, a text field with its error under it, and the
  `AsyncResult` view. On failure that view shows `describeFailure`, which is
  the error's own `message` for the domain errors and the client's wording
  for the transport error, and a generic message for a defect.
- `test/` holds the Bun tests.
- `scripts/` builds the C++ and runs the code generator.

`@effect/platform-node-shared` is pinned to 4.0.7 only to match
`effect` 4.0.7. `@effect/platform-bun` asks for `^4.0.7`, which would pull in
4.1, and 4.1 needs effect 4.1.
