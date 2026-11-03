# Effect playground

A sandbox for learning Effect. The page has two forms, and both talk to the
BFF over Effect RPC (`effect/rpc`). In the first, type a file name, submit,
and the file's contents come back. In the second, type an input and an
output file, and `custom_cat` copies one to the other. Files live in
`files/`.

A request whose fields are wrong fails with `InvalidRequest`, which lists
every problem as an **issue**: `{ code, message, path }`, the shape of a
Standard Schema issue plus a code. The codes:

- `Missing`: the field is absent.
- `TooShort`, `TooLong`: a name must be 5 to 25 characters long.
- `NotTxtFile`: a name must end in `.txt`.
- `FileNotFound`: the file to read or copy doesn't exist.

The rules, and each code's message, live on C++ types, and everything else
gets them from the generated schema (see below). Anything that isn't about a
field, such as a directory named `x.txt`, is a defect.

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
  An `InvalidRequest` is a 422 whose body is its JSON, such as
  `{"_tag":"InvalidRequest","issues":[{"code":"NotTxtFile","message":"\"config.json\" is not a .txt file","path":["name"]}]}`.
- MCP, for MCP clients: the `custom_cat` tool, over Streamable HTTP at
  `/mcp`, protocol 2025-11-25 or 2025-06-18. Its parameters are
  `CustomCat.Request`; an `InvalidRequest` comes back as a tool error whose
  text has a line per issue, its field first:
  `inputFile: "config.json" is not a .txt file`.

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
reader (`rfl/cli.hpp`) spells in kebab-case. Both names follow the read's
rules, and only the input must exist. What it prints, and its exit codes:

- 0, copied: stdout is `{"bytesCopied":18}`.
- 1, a field is wrong, or missing: stdout is the `InvalidRequest`, with
  every issue, such as
  `{"_tag":"InvalidRequest","issues":[{"code":"NotTxtFile","message":"\"config.json\" is not a .txt file","path":["inputFile"]},{"code":"NotTxtFile","message":"\"x.json\" is not a .txt file","path":["outputFile"]}]}`.
- 2, a usage error that names no field, such as an unknown flag:
  reflect-cpp's error, on stderr.
- 3, anything else, such as a directory named `x.txt`: on stderr.

stdout is JSON in the generated schemas' wire form: `CustomCat.Success` on
0, `CustomCat.InvalidRequest` on 1. The BFF's `CustomCatCli` runs it with
Effect's `ChildProcess` and decodes stdout with those schemas, into a success
or a typed failure; any other exit, or output that doesn't decode, is a
defect.

## The protocol

The C++ structs in `cpp/include/protocol.hpp` define each procedure's
request and success: `ReadFile`, which `BffReader` serves, and `CustomCat`,
which `custom_cat` runs. `Procedures` lists them. Both fail with
`InvalidRequest`, a list of `Issue`s, which are structs there too. Fields are
snake_case in C++ and camelCase in JSON, through reflect-cpp's
`SnakeCaseToCamelCase` (`protocol::Wire`).

A field carries its rules in its type, a `Checked<Base, Rules...>`
(`cpp/include/checked.hpp`). A rule has an issue code, a message template and
a check:

```cpp
struct TxtFile {
	static constexpr IssueCode code = IssueCode::NotTxtFile;
	static constexpr std::string_view message = "\"{value}\" is not a .txt file";
	static bool passes(const std::string& value);
};
using Name = Checked<std::string, MinLength<5>, MaxLength<25>>;
using FileName = Checked<Name, TxtFile>;
using Existing = Checked<FileName, ExistingFile>;
```

`{value}` stands for the field's value, and `{limit}` for a bound's limit. A
`Checked` whose base is another one only runs its rules on a value the base
accepts, so `x.md` is too short and nothing else. `input_file` is `Existing`
and `output_file` a `FileName`, so only the input must exist.

reflect-cpp reads a request without the rules: any value fits a `Checked`,
and with `rfl::DefaultIfMissing` an absent one is missing rather than an
error. Then `validate::validate` (`cpp/include/validate.hpp`) walks the
request's fields with `rfl::to_view`, into nested structs and arrays, runs
every field's rules and collects an `Issue` for each that fails, its path the
fields' wire names and the arrays' indexes, such as `["files", 2, "input"]`.

1. reflect-cpp turns the structs into JSON Schema: `cpp/build/protocol_schema`
   writes `cpp/protocol.schema.json`. A bound's `rfl::Size` validator becomes
   `minLength` or `maxLength`. The tool adds `x-issues`, each code's template
   and, for a bound, the keyword that carries its limit.
2. `scripts/generate.ts` turns that into Effect Schema in one module,
   `src/shared/generated/protocol.ts`: a TypeScript namespace per method,
   named after it, such as `ReadFile`. In it, `Request` and `Success` are the
   payload and the success, `Path` the union of every field's path, such as
   `readonly ["inputFile"] | readonly ["outputFile"]`, `Issue` an issue on one
   of them, and `InvalidRequest` a `Schema.TaggedError` with a non-empty
   `issues`, whose `message` joins theirs. `Failure` is `InvalidRequest`
   (`Failure`, because an `Error` there would shadow the global one). Each
   name is both the schema and its type, so `ReadFile.Success` works in
   either position, and TypeScript 7 hovers read `ReadFile.Success`. Before
   the namespaces, `IssueCode` lists the codes, `IssueMessage` has a function
   per code that fills in its template, such as
   `IssueMessage.NotTxtFile({ value })`, and `fieldOf(path)` turns a path into
   react-hook-form's field name, typed: `fieldOf(["inputFile"])` is
   `"inputFile"`, a path `["files", number, "input"]` is
   `` `files.${number}.input` ``.
3. `BffReader` fails with `ReadFile.InvalidRequest`, its issues worded by
   `IssueMessage`, and `src/shared/rest-api.ts` gives it status 422.

A bound travels as its JSON Schema keyword, and the TS field checks it with
the message of the code that carries that keyword:
`Schema.String.check(Schema.isMinCodePoints(5, { message: IssueMessage.TooShort({ limit: 5 }) }), …)`.
Each boundary rejects a name out of bounds:

- REST: `:name` is `ReadFile.Request.fields.name`, so HttpApi answers 400, and
  a client HttpApi derives fails with a `SchemaError` before sending anything.
- RPC: the client can't encode the payload and dies before sending. A raw
  request gets an `Exit` whose cause is a `Die` with the schema's message.
- The page: each form's react-hook-form validates against the same field,
  so it shows the message under that input and never sends the request.
- MCP: the tool's parameters don't decode, so the call is a tool error.
- `custom_cat`: a `TooShort` or `TooLong` issue, with exit 1.

The rest, `.txt` and existence, only the BFF and `custom_cat` check.

After changing the structs, run `bun run generate`: it rebuilds the C++,
re-emits the schema and regenerates the TypeScript. Both outputs are
committed. `bun run generate:check` fails if either is stale, or if
`src/shared/generated/` holds a file the generator no longer writes. The
generator fails on a template that names anything but `{value}` (or
`{limit}`, for a bound), on a code without a template, on a bound no code
carries, and on an `InvalidRequest` field that would shadow the `Error`'s
own, such as `message`.

## Checks

```sh
bun run check            # tsc
bun run lint             # biome; bun run fix formats
bun run knip
bun run test             # builds the C++; runs custom_cat, the walker and the BFF
bun run generate:check
```

The tests that run the C++ skip when `cmake` isn't on the PATH. The walker's
runs `cpp/build/validate_fixture`, a test-only executable that validates a
request with an array of structs. `test/protocol-types.test.ts` holds the
type tests, which `bun run check` runs.

## Layout

- `cpp/` holds the protocol's structs, `Checked` and the walker, `custom_cat`
  and the tool that emits the schema. `cpp/build/` is ignored.
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
  procedure's `InvalidRequest` or the client's `RpcClientError`. A submit
  runs the mutation and waits for its `Exit`, which keeps the button disabled
  meanwhile. `forms/shared.tsx` holds what both use: the resolver hook, a
  text field with its error under it, `setFailure` and `Outcome`. On a
  failed submit, `setFailure` puts each issue under its field with
  `setError(fieldOf(issue.path), { type: "server", message })`, where the
  resolver's errors go; react-hook-form drops it once the field changes and
  passes the resolver, or on the next submit. A transport error or a defect
  becomes `root.server`, which `Outcome` shows where the success goes.
- `test/` holds the Bun tests.
- `scripts/` builds the C++ and runs the code generator.

`@effect/platform-node-shared` is pinned to 4.0.7 only to match
`effect` 4.0.7. `@effect/platform-bun` asks for `^4.0.7`, which would pull in
4.1, and 4.1 needs effect 4.1.
