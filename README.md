# Effect playground

A sandbox for learning Effect. The page has two forms, and both talk to the
BFF over Effect RPC (`effect/rpc`). In the first, type a file name, submit,
and the file's contents come back. In the second, type an input and an
output file, and `custom_cat` copies one to the other. Files live in
`files/`.

A request whose fields are wrong fails with `InvalidRequest`, which lists
every problem as an **issue**: `{ message, path }`, a Standard Schema
issue. Each comes from a rule, named for what it reports:

- `Missing`: the field is absent.
- `TooShort`, `TooLong`: a name must be 5 to 25 characters long.
- `NotPlainName`: a name is a file name, not a path: no `/` or `\`, and not
  `.` or `..`.
- `NotTxtFile`: a name must end in `.txt`.
- `LeavesFiles`: the name is a link in `files/`. No link is followed, even
  one that stays in `files/`, and neither is a name that resolves outside it.
- `FileNotFound`: the file to read or copy doesn't exist.
- `SameAsInput`: the output names the input.
- `SameFileAsInput`: the output is the input under another name, a hard
  link.

The rules, and each rule's message, live on C++ types, and everything else
gets them from the generated schema (see below).

The **BFF** (backend-for-frontend) is a Bun server; it serves the page over
RPC, a REST API (`effect/http-api`) for other clients, and an MCP server
(`effect/ai`) whose one tool, `custom_cat`, runs the C++ executable of that
name, which copies one `.txt` file to another.

## What can go wrong

Every way a request can go wrong is in one bucket, and each bucket is one of
the three things an Effect's cause can hold: a `Fail` (a typed error, in the
error channel), a `Die` (a defect) or an `Interrupt`.

| Bucket | What it is | Effect | Type |
|---|---|---|---|
| Shape | a wrong type, a missing or unknown field | `Fail`, or `Die` on RPC | `InvalidRequest` |
| Rule | a value breaks a rule on its own, or against another field | `Fail` | `InvalidRequest` |
| Precondition | a value conflicts with the files: the input is missing, a name is a link, the output is the input | `Fail` | `InvalidRequest` |
| Dependency | a file can't be read or written, or `custom_cat` can't run | `Fail` | `IoFailed`, `CliFailed` |
| Transport | the page can't reach the BFF | `Fail` | `RpcClientError` |
| Contract | `custom_cat`'s output doesn't match the protocol | `Die` | `ContractMismatch` |
| Defect | a bug | `Die` | anything |
| Interruption | the call was abandoned | `Interrupt` | none |

- `IoFailed` is a read or write that failed for a reason that isn't about a
  name, such as a directory named `x.txt` or a read-only `files/`:
  `{ operation, file, reason }`, read as
  `Couldn't write "x.txt": Is a directory`. It's declared in the C++
  protocol, which both `custom_cat` and the BFF's reader produce.
- `CliFailed` is the BFF failing to run `custom_cat` to its end: its
  `reason` is `NotFound`, `NotExecutable`, `NotStarted`, `Killed` (with the
  signal) or `TimedOut` (after five seconds, by default). Only the BFF sees
  it, so it's declared in TS, in `src/shared/cli-failed.ts`.
- `ContractMismatch` is the BFF and `custom_cat` disagreeing: output that
  doesn't decode, an exit code whose output belongs to another, a usage
  error (the BFF built the flags) or an exit code `custom_cat` doesn't have.
  It carries the exit code, stdout, stderr and the issue, and the BFF logs
  it where it happens. It stays a defect: no caller can act on it.
- A timeout is `CliFailed` to the caller; inside `CustomCatCli` it
  interrupts the run, which kills `custom_cat`, as an abandoned call does.

How each surfaces:

| Bucket | RPC (the page) | REST | MCP |
|---|---|---|---|
| Shape | the form shows the issue and sends nothing; a raw request gets a `Die` | 422, the `InvalidRequest` as JSON | a tool error from McpServer: `Invalid parameters for tool 'custom_cat': …` |
| Rule, Precondition | `InvalidRequest`: each issue under its field | 422, the `InvalidRequest` as JSON | a tool error, a line per issue: `outputFile: Must not be the input file` |
| Dependency | the error's `message` as the root message | `IoFailed` 500, `CliFailed` 503, as JSON | a tool error whose text is the `message` |
| Transport | `Request failed: ` and its cause, such as `Transport error (POST …/rpc/)` | | |
| Contract, Defect | `Something went wrong.` | an empty 500 | `Tool execution failed due to an internal server error.` |
| Interruption | nothing | | |

The BFF logs every defect: `CustomCatCli` a `ContractMismatch`, the RPC
handlers the rest, which RpcServer sends without logging, and HttpApi and
McpServer their own.

Shape is a `Die` on RPC because `RpcServer` decodes the payload before any
handler or middleware runs, and a payload that doesn't decode becomes a
defect with the schema's message, with no hook to turn it into a typed
error. The ways around it, a payload schema of `Schema.Unknown` or one
without checks, decoded in the handler, would lose the typed payload the
client encodes with. The page's client encodes the payload with the same
schema before sending, and its forms check it first, so only a raw request
meets it. HttpApi has the hook: `HttpApiMiddleware.layerSchemaErrorTransform`.
A middleware on each endpoint turns every request that doesn't decode, of
the wrong shape or against a rule the schema carries (`TooShort`, `TooLong`,
`NotPlainName`), into the method's `InvalidRequest`, its issues from
`SchemaIssue.makeFormatterStandardSchemaV1`: `{"inputFile": 42}` is
`Expected string` on `["inputFile"]` and `Required` on `["outputFile"]`. An
issue off the method's fields goes on `[]`, the whole request, its message
saying where: an unknown field is `verbose: Unknown field`, and a body that
isn't an object `Expected object`. No form or MCP client meets `[]`.

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
- REST, for other clients: `GET /api/files/read/:name` and
  `POST /api/files/copy`, whose JSON body is `CustomCat.Request`. A client
  HttpApi derives from `BffApi` calls them as
  `client.files.read({ params: { name } })` and
  `client.files.copy({ payload })`. An `InvalidRequest` is a 422 whose body
  is its JSON, such as
  `{"_tag":"InvalidRequest","issues":[{"message":"\"config.json\" is not a .txt file","path":["name"]}]}`.
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
working directory. It writes a temporary file next to the output and renames
it over the output, so a write that fails leaves the old output as it was,
and removes the temporary file. One killed mid-copy can leave a
`.custom_cat-…` file, which no request can name.

```sh
custom_cat --input-file=hello.txt --output-file=copy.txt
```

Its flags are the fields of `CustomCatRequest`, which reflect-cpp's CLI
reader (`rfl/cli.hpp`) spells in kebab-case. Both names follow the read's
rules, and only the input must exist. What it prints, and its exit codes:

- 0, copied: stdout is `{"bytesCopied":18}`.
- 1, a field is wrong, or missing: stdout is the `InvalidRequest`, with
  every issue, such as
  `{"_tag":"InvalidRequest","issues":[{"message":"\"config.json\" is not a .txt file","path":["inputFile"]},{"message":"\"x.json\" is not a .txt file","path":["outputFile"]}]}`.
- 2, a usage error that names no field, such as an unknown flag:
  reflect-cpp's error, on stderr.
- 3, a file couldn't be read or written: stdout is the `IoFailed`, such as
  `{"_tag":"IoFailed","operation":"read","file":"dir.txt","reason":"Is a directory"}`.
- 4, anything else, which would be a bug in `custom_cat`: on stderr.

stdout is JSON in the generated schemas' wire form: `CustomCat.Success` on
0, `CustomCat.InvalidRequest` on 1 and `IoFailed` on 3. The BFF's
`CustomCatCli` runs it with Effect's `ChildProcess`, in a scope whose end
kills it (`SIGTERM`, then `SIGKILL` a second later), and decodes stdout with
those schemas, into a success or a typed failure. Exit 4 is a defect; exit
2, any other code, or output that doesn't decode is a `ContractMismatch`.
`CustomCatCli.layerWith({ directory, binary, timeout })` sets where it runs,
which executable it runs and how long it may take; the tests point `binary`
at shell scripts.

## The protocol

The C++ structs in `cpp/include/protocol.hpp` define each procedure's
request and success: `ReadFile`, which `BffReader` serves, and `CustomCat`,
which `custom_cat` runs. `Procedures` lists them. Both fail with
`InvalidRequest`, a list of `Issue`s, which are structs there too, or with
`IoFailed`, whose static `message` is a template over its fields. Fields are
snake_case in C++ and camelCase in JSON, through reflect-cpp's
`SnakeCaseToCamelCase` (`protocol::Wire`).

A field carries its rules in its type, a `Checked<Base, Rules...>`
(`cpp/include/checked.hpp`). A rule has a name, a message template and
a check:

```cpp
struct TxtFile {
	static constexpr std::string_view name = "NotTxtFile";
	static constexpr std::string_view message = "\"{value}\" is not a .txt file";
	static bool passes(const std::string& value);
};
using Name = Checked<std::string, MinLength<5>, MaxLength<25>>;
using FileName = Checked<Name, PlainName, TxtFile>;
using InFiles = Checked<FileName, NotALink>;
using Existing = Checked<InFiles, ExistingFile>;
```

`{value}` stands for the field's value, and `{limit}` for a bound's limit. A
`Checked` whose base is another one only runs its rules on a value the base
accepts, so `x.md` is too short and nothing else, and the rules come before
what the files say. `input_file` is `Existing` and `output_file` `InFiles`,
so only the input must exist.

A rule across fields lives on the request, in its `Rules`, and names the
member its issue goes on:

```cpp
struct DifferentNames {
	static constexpr std::string_view name = "SameAsInput";
	static constexpr std::string_view message = "Must not be the input file";
	static constexpr auto field = &CustomCatRequest::output_file;
	static bool passes(const CustomCatRequest& request);
};
// in CustomCatRequest:
using Rules = std::tuple<DifferentNames, DifferentFiles>;
```

They run in order once every field passes its own rules, and stop at the
first that fails, as a `Checked`'s refinements do.

reflect-cpp reads a request without the rules: any value fits a `Checked`,
and with `rfl::DefaultIfMissing` an absent one is missing rather than an
error. Then `validate::validate` (`cpp/include/validate.hpp`) walks the
request's fields with `rfl::to_view`, into nested structs and arrays, runs
every field's rules, then each struct's, and collects an `Issue` for each
that fails, its path the fields' wire names and the arrays' indexes, such as
`["files", 2, "input"]`.

1. reflect-cpp turns the structs into JSON Schema: `cpp/build/protocol_schema`
   writes `cpp/protocol.schema.json`. A bound's `rfl::Size` validator becomes
   `minLength` or `maxLength`, and `PlainName`'s `rfl::PatternValidator` a
   `pattern`. The tool adds `x-issues`, each rule's template, by its name,
   and, for a rule with a schema, the keyword that carries it, and
   `x-errors`, the template of each error besides `InvalidRequest`.
2. `scripts/generate.ts` turns that into Effect Schema in one module,
   `src/shared/generated/protocol.ts`: a TypeScript namespace per method,
   named after it, such as `ReadFile`. In it, `Request` and `Success` are the
   payload and the success, `Path` the union of every field's path and `[]`,
   the whole request, such as
   `readonly ["inputFile"] | readonly ["outputFile"] | readonly []`, `Issue`
   an issue at one of them, `{ message, path }`, and `InvalidRequest` a
   `Schema.TaggedError` with a non-empty `issues`, whose `message` joins
   theirs. `Failure` is `InvalidRequest` or
   `IoFailed` (`Failure`, because an `Error` there would shadow the global
   one). `IoFailed` is declared once, before the namespaces, a
   `Schema.TaggedError` whose `message` fills in its template. Each
   name is both the schema and its type, so `ReadFile.Success` works in
   either position, and TypeScript 7 hovers read `ReadFile.Success`. Before
   the namespaces, `IssueMessage` has a function per rule, by its name, that
   fills in its template, such as
   `IssueMessage.NotTxtFile({ value })`, and `fieldOf(path)` turns a path into
   react-hook-form's field name, typed: `fieldOf(["inputFile"])` is
   `"inputFile"`, a path `["files", number, "input"]` is
   `` `files.${number}.input` ``.
3. `BffReader` fails with `ReadFile.InvalidRequest`, its issues worded by
   `IssueMessage`, or `IoFailed`, and `src/shared/rest-api.ts` gives them
   statuses 422 and 500.

A bound or a pattern travels as its JSON Schema keyword, and the TS field
checks it with the message of the rule that carries that keyword:
`Schema.String.check(Schema.isMinCodePoints(5, { message: IssueMessage.TooShort({ limit: 5 }) }), …)`.
Each boundary rejects a name out of bounds, or a path:

- REST: `:name` is `ReadFile.Request.fields.name`, so HttpApi rejects it
  before the handler and answers a 422 with the issue, and a client HttpApi
  derives fails with a `SchemaError` before sending anything.
- RPC: the client can't encode the payload and dies before sending. A raw
  request gets an `Exit` whose cause is a `Die` with the schema's message.
- The page: each form's react-hook-form validates against the same field,
  so it shows the message under that input and never sends the request.
- MCP: the tool's parameters don't decode, so the call is a tool error.
- `custom_cat`: a `TooShort`, `TooLong` or `NotPlainName` issue, with exit 1.

The rest, `.txt`, links, existence and the rules across fields, only the
BFF and `custom_cat` check.

After changing the structs, run `bun run generate`: it rebuilds the C++,
re-emits the schema and regenerates the TypeScript. Both outputs are
committed. `bun run generate:check` fails if either is stale, or if
`src/shared/generated/` holds a file the generator no longer writes. The
generator fails on a template that names anything but `{value}` (or only
`{limit}`, for a rule a keyword carries), on a keyword no rule carries or two
rules carry, on an Issue with more than `message` and `path`, on an error's
template that
names anything but its fields, and on an error's field that would shadow the
`Error`'s own, such as `message`.

## Checks

```sh
bun run check            # tsc
bun run lint             # biome; bun run fix formats
bun run knip
bun run test             # builds the C++; runs custom_cat, the walker, the BFF and the forms' matching
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
  (`BffApi`), the RPC group (`BffRpcs`), `CliFailed`, and the generated
  protocol.
- `src/server/` is the BFF: `BffReader` and `CustomCatCli`, and the three
  transports mounted on one router.
- `src/client/` builds the RPC client as `AtomRpc` atoms (`effect/reactivity`),
  `BffRpcClient`, with a mutation per procedure, `readFile` and `customCat`.
  The client's runtime is an atom too, so the protocol is built once, not per
  submit. `main.tsx` wraps the page in `@effect/atom-react`'s
  `RegistryProvider`, which holds the atoms. `App` renders two forms,
  `forms/read-file.tsx` (`ReadFileForm`) and `forms/run-cli.tsx`
  (`RunCliForm`), and passes each its schema, the generated `ReadFile.Request`
  or `CustomCat.Request`, which its react-hook-form resolver uses. Each runs
  its procedure's mutation, which holds an `AsyncResult` of the success
  struct, failing with exactly the procedure's `Failure` (and `CliFailed`, for
  a copy) or the client's `RpcClientError`: `Atom.Failure<typeof customCat>`.
  `forms/shared.tsx` holds what both use: the resolver hook, a text field with
  its error under it, `FormFailure`, either mutation's failure, `setIssues`
  and `Outcome`. A submit runs the mutation and waits for its `Exit`, which
  keeps the button disabled meanwhile, and matches its error with
  `Match.valueTags`: an `InvalidRequest` goes to `setIssues`, which puts the
  first issue per field under it with
  `setError(fieldOf(issue.path), { type: "server", message })`, where the
  resolver's errors go; react-hook-form drops it once the field changes and
  passes the resolver, or on the next submit. `Outcome` renders the
  mutation's `AsyncResult` with `AsyncResult.builder`, where the success
  goes: the success, a Dependency's `message`, `Request failed: ` for the
  transport, `Something went wrong.` for a defect, and nothing for an
  `InvalidRequest`, an interruption, or a failure while the next submit
  waits. Both matchers are exhaustive (`exhaustive()`, and `valueTags` without
  a fallback), so a new error doesn't compile until each handles it.
- `test/` holds the Bun tests.
- `scripts/` builds the C++ and runs the code generator.

`@effect/platform-node-shared` is pinned to 4.0.7 only to match
`effect` 4.0.7. `@effect/platform-bun` asks for `^4.0.7`, which would pull in
4.1, and 4.1 needs effect 4.1.
