# Effect playground

A sandbox for learning Effect. The page has two forms, and both talk to the
BFF over Effect RPC (`effect/rpc`). In the first, type a file name, submit,
and the file's contents come back. In the second, type an input and an
output file, and `custom_cat` copies one to the other. Files live in
`files/`.

A request whose fields are wrong fails with `InvalidRequest`, which lists
every problem as an **issue**: `{ message, path }`, a Standard Schema
issue. The rules:

- every field is present;
- a name is 5 to 25 characters long;
- a name is a plain file name, not a path: no `/` or `\`, and not `.` or
  `..`;
- a name ends in `.txt`;
- a name isn't a link in `files/`. No link is followed, even one that stays
  in `files/`, and neither is a name that resolves outside it;
- the file to read or copy exists;
- a copy's output isn't its input, by name or through a hard link.

An issue's `message` is whatever checked the rule says, as it says it: a
reflect-cpp validator's error in `custom_cat`, Effect Schema's message in
the page and the BFF, or the system's error for a file that doesn't exist.
Where nothing says anything, the check has a plain literal. There are no
message templates and no rule codes, and the errors that aren't issues
follow the same rule.

Who checks the rules depends on the method:

- `CustomCat`'s rules live on C++ types, in `cpp/include/protocol.hpp`. The
  page's form checks them with the TypeScript schema generated from them
  (see below), so it shows Effect's own messages and sends nothing that
  breaks one. The BFF checks a copy's shape only and leaves the rules to
  `custom_cat`, so every issue a copy comes back with is `custom_cat`'s,
  word for word.
- `ReadFile` is the BFF's own, with no C++ step: its schema is written in
  TypeScript, in `src/shared/read-file.ts`, and `BffReader` checks the name
  with it, then the files.

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
  `{ message }`, what the system said about the errno. `custom_cat` says
  `Is a directory` (`std::generic_category()`), and the BFF's reader
  `illegal operation on a directory` (`getSystemErrorMessage`). It's
  declared in the C++ protocol, which both produce.
- `CliFailed` is the BFF failing to run `custom_cat` to its end:
  `{ message }`. It's the spawner's own message when `custom_cat` doesn't
  start, such as
  `NotFound: ChildProcess.spawn (…/custom_cat --input-file=… --output-file=…)`,
  the signal's when it's killed,
  `Process interrupted due to receipt of signal: 'SIGKILL'`, and
  `custom_cat timed out after 5000 ms` after five seconds, by default. Only
  the BFF sees it, so it's declared in TS, in `src/shared/cli-failed.ts`.
- `ContractMismatch` is the BFF and `custom_cat` disagreeing: output that
  doesn't decode, output whose tag isn't its exit code's, a usage error
  (the BFF built the flags) or an exit code `custom_cat` doesn't have.
  It carries the exit code, stdout, stderr and the issue, and the BFF logs
  it where it happens. It stays a defect: no caller can act on it.
- A timeout is `CliFailed` to the caller; inside `CustomCatCli` it
  interrupts the run, which kills `custom_cat`, as an abandoned call does.

How each surfaces:

| Bucket | RPC (the page) | REST | MCP |
|---|---|---|---|
| Shape | a raw request gets a `Die` | 422, the `InvalidRequest` as JSON | a tool error from McpServer: `Invalid parameters for tool 'custom_cat': …` |
| Rule, Precondition | `InvalidRequest`: each issue under its field; the form shows a rule's issue in Effect's words and sends nothing | 422, the `InvalidRequest` as JSON | a tool error, a line per issue: `outputFile: Must not be the input file` |
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
error. So each method's payload schema is its `RequestShape`, the request's
fields with their types and no rules: a payload that breaks a rule decodes,
and the handler answers it with the method's `InvalidRequest`, `custom_cat`'s
for a copy and `BffReader`'s for a read. Only a payload of the wrong shape
dies, which the page's client never sends, since it encodes the payload
with the same schema. The REST body and the MCP tool's parameters are
`RequestShape`s too.

HttpApi has the hook: `HttpApiMiddleware.layerSchemaErrorTransform`. A
middleware on the copy endpoint turns a body that doesn't decode into
`CustomCat.InvalidRequest`, its issues from
`SchemaIssue.makeFormatterStandardSchemaV1` as they come:
`{"inputFile": 42}` is `Expected string` on `["inputFile"]` and
`Missing key` on `["outputFile"]`. An issue off the method's fields goes on
`[]`, the whole request, its message saying where: an unknown field is
`verbose: Expected no excess property`, and a body that isn't an object
`Expected object`. No form or MCP client meets `[]`. The read endpoint's
`:name` is any string, so it needs no middleware.

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
  `POST /api/files/copy`, whose JSON body is `CustomCat.RequestShape`. A
  client HttpApi derives from `BffApi` calls them as
  `client.files.read({ params: { name } })` and
  `client.files.copy({ payload })`. An `InvalidRequest` is a 422 whose body
  is its JSON, such as
  `{"_tag":"InvalidRequest","issues":[{"message":"Expected a string matching the RegExp ^.+\\.txt$","path":["name"]}]}`.
- MCP, for MCP clients: the `custom_cat` tool, over Streamable HTTP at
  `/mcp`, protocol 2025-11-25 or 2025-06-18. Its parameters are
  `CustomCat.RequestShape`; `custom_cat`'s `InvalidRequest` comes back as a
  tool error whose text has a line per issue, its field first:
  `inputFile: String 'config.json' did not match format '.txt file name': '^.+\.txt$'.`

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

- 0, copied: stdout is `{"_tag":"Success","bytesCopied":18}`.
- 1, a field is wrong, or missing: stdout is the `InvalidRequest`, with
  every issue, such as
  `{"_tag":"InvalidRequest","issues":[{"message":"String 'config.json' did not match format '.txt file name': '^.+\\.txt$'.","path":["inputFile"]},{"message":"String 'x.json' did not match format '.txt file name': '^.+\\.txt$'.","path":["outputFile"]}]}`.
- 2, a usage error that names no field, such as an unknown flag:
  reflect-cpp's error, on stderr.
- 3, a file couldn't be read or written: stdout is the `IoFailed`, such as
  `{"_tag":"IoFailed","message":"Is a directory"}`.
- 4, anything else, which would be a bug in `custom_cat`: on stderr.

stdout, on 0, 1 and 3, is one `CustomCatOutput`, a tagged union declared in
C++, which is `CustomCat.Output` in TS: `Success`, `InvalidRequest` or
`IoFailed`. The BFF's `CustomCatCli` runs it with Effect's `ChildProcess`, in
a scope whose end kills it (`SIGTERM`, then `SIGKILL` a second later),
decodes stdout once with `CustomCat.Output`, checks that its tag is its
exit code's, and dispatches with `Match.valueTags`: `Success` succeeds with
`{ bytesCopied }`, without its tag, and the others fail. A new kind of
output in C++ doesn't compile in the BFF until it's handled. Exit 4 is a
defect; exit 2, any other code, output that doesn't decode, or a tag that
isn't its exit code's is a `ContractMismatch`.
`CustomCatCli.layerWith({ directory, binary, timeout })` sets where it runs,
which executable it runs and how long it may take; the tests point `binary`
at shell scripts.

## The protocol

The C++ structs in `cpp/include/protocol.hpp` define `CustomCat`'s request
and output, which `custom_cat` takes and prints. `Procedures` lists the
procedures, `CustomCat` alone. A procedure's `output` is a tagged union of
its success, whose `using Tag = rfl::Literal<"Success">` names it,
`InvalidRequest`, a list of `Issue`s, which are structs there too, and
`IoFailed`, whose one field is its `message`. Fields are snake_case in C++ and
camelCase in JSON, through reflect-cpp's `SnakeCaseToCamelCase`
(`protocol::Wire`).

A field carries its rules in its type, a `Checked<Base, Validators...>`
(`cpp/include/checked.hpp`) of reflect-cpp validators: reflect-cpp's own
where it has one, and otherwise a struct with reflect-cpp's validator
interface, `static rfl::Result<T> validate(T)`:

```cpp
using PlainName =
	rfl::PatternValidator<R"(^(?!\.\.?$)[^/\\]*$)", "plain file name">;
using TxtFile = rfl::PatternValidator<R"(^.+\.txt$)", ".txt file name">;
struct NotALink {
	static rfl::Result<std::string> validate(const std::string& name);
};
using Text = Checked<std::string, Utf8>;
using Name =
	Checked<Text, CodePoints<rfl::Minimum<5>>, CodePoints<rfl::Maximum<25>>>;
using FileName = Checked<Name, PlainName, TxtFile>;
using InFiles = Checked<FileName, NotALink>;
using Existing = Checked<InFiles, ExistingFile>;
```

An issue's message is the validator's error, `rfl::Error::what()`, as it
is:

| Rule | Validator | Message |
|---|---|---|
| valid UTF-8 | `Utf8` | `String is not valid UTF-8.` |
| 5 or more characters | `CodePoints<rfl::Minimum<5>>` | `Code point count validation failed: Value expected to be greater than or equal to 5, but got 4.` |
| 25 or fewer | `CodePoints<rfl::Maximum<25>>` | `Code point count validation failed: Value expected to be less than or equal to 25, but got 27.` |
| a plain name | `PlainName` | `String '../x.txt' did not match format 'plain file name': '^(?!\.\.?$)[^/\\]*$'.` |
| `.txt` | `TxtFile` | `String 'config.json' did not match format '.txt file name': '^.+\.txt$'.` |
| not a link | `NotALink` | `"out.txt" is a link, which could lead outside the files directory` |
| exists | `ExistingFile` | the `std::error_code`'s message: `No such file or directory` |
| not the input | `DifferentNames` | `Must not be the input file` |
| not a hard link to the input | `DifferentFiles` | `"same.txt" is the input file under another name` |
| present | none: the walker | `Required` |

`CodePoints<V>` is `rfl::Size<V>` counting a string's code points, not its
bytes, with `Size`'s schema: JSON Schema's `minLength` and `maxLength`, and
so the form, count code points too, so both sides take the same names. The
comparison and its words are the wrapped `rfl::Minimum` or `rfl::Maximum`'s.

A `Checked` whose base is another one only runs its validators on a value
the base accepts, so `x.md` is too short and nothing else, and the rules
come before what the files say. `input_file` is `Existing` and
`output_file` `InFiles`, so only the input must exist.

A rule across fields lives on the request, in its `Rules`: a validator of
the struct, which names the member its issue goes on:

```cpp
struct DifferentNames {
	static constexpr auto field = &CustomCatRequest::output_file;
	static rfl::Result<CustomCatRequest> validate(
		const CustomCatRequest& request);
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
every field's validators, then each struct's, and collects an `Issue` for
each that fails, its path the fields' wire names and the arrays' indexes,
such as `["files", 2, "input"]`. A missing field is the one message the
walker writes, `Required`: reflect-cpp's own, `Field named 'output-file' not
found.`, only comes from a read that fails as a whole, with no field to put
it on.

1. reflect-cpp turns the structs into JSON Schema: `cpp/build/protocol_schema`
   writes `cpp/protocol.schema.json`. A validator with a schema becomes its
   keyword: `CodePoints` `minLength` or `maxLength`, a `PatternValidator` a
   `pattern`; `NotALink` and `ExistingFile` have none.
2. `scripts/generate.ts` turns that into Effect Schema in one module,
   `src/shared/generated/protocol.ts`: a TypeScript namespace per method,
   named after it, `CustomCat`. In it, `Request` is the payload, `Success`
   the output's first alternative without its tag, `Output` the whole union,
   with the success tagged, and `RequestShape` is `Request` without its
   checks, nested structs inlined. Each keyword becomes Effect's check, with
   Effect's own message: `Schema.isMinCodePoints(5)`,
   `Schema.isPattern(/^.+\.txt$/u)`. `Path` is the union of every field's
   path and `[]`, the whole request, such as
   `readonly ["inputFile"] | readonly ["outputFile"] | readonly []`, `Issue`
   an issue at one of them, `{ message, path }`, and `InvalidRequest` a
   `Schema.TaggedError` with a non-empty `issues`, whose `message` joins
   theirs. `Failure` is `InvalidRequest` or `IoFailed` (`Failure`, because
   an `Error` there would shadow the global one). `IoFailed` is declared
   once, before the namespaces, a `Schema.TaggedError` of its fields, whose
   `message` field is its message. Each name is both the schema and its type, so
   `CustomCat.Success` works in either position, and TypeScript 7 hovers read
   `CustomCat.Success`.
3. The page's copy form validates with `CustomCat.Request`; the RPC payload,
   the REST body and the MCP tool's parameters are `CustomCat.RequestShape`.

`ReadFile` is written by hand in `src/shared/read-file.ts`, in the same
shape: a namespace with `Request`, whose name has the same rules as a copy's
names, `RequestShape`, `Success`, `Path`, `Issue`, `InvalidRequest` and
`Failure`, which reuses the generated `IoFailed`. The page's read form
validates with `ReadFile.Request`, and the RPC payload and REST `:name` are
its `RequestShape`. `BffReader` decodes the name with
`ReadFile.Request.fields.name`, and a name it rejects is an issue with the
decode's message, such as
`Expected a string with at least 5 code points`. Then it refuses a link, a
literal, `"out.txt" is a link, which could lead outside the files directory`,
and a file that doesn't exist with the system's message,
`no such file or directory`. `src/shared/rest-api.ts` gives
`InvalidRequest` 422 and `IoFailed` 500.

`fieldOf(path)` (`src/shared/field-of.ts`) turns either method's path into
react-hook-form's field name, typed: `fieldOf(["inputFile"])` is
`"inputFile"`, a path `["files", number, "input"]` is
`` `files.${number}.input` ``.

After changing the structs, run `bun run generate`: it rebuilds the C++,
re-emits the schema and regenerates the TypeScript. Both outputs are
committed. `bun run generate:check` fails if either is stale, or if
`src/shared/generated/` holds a file the generator no longer writes. The
generator fails on an Issue with more than `message` and `path`, on an
output that isn't a tagged success, then `InvalidRequest`, then tagged
errors, and on an error's field that would shadow the `Error`'s own, such as
`name`.

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
  (`BffApi`), the RPC group (`BffRpcs`), `CliFailed`, `ReadFile`, `fieldOf`,
  and the generated protocol.
- `src/server/` is the BFF: `bun-side/` holds `BffReader`, `cpp-side/`
  `CustomCatCli`, and `protocols/` the three transports, which `main.ts`
  mounts on one router.
- `src/client/` builds the RPC client as `AtomRpc` atoms (`effect/reactivity`),
  `BffRpcClient`, with a mutation per procedure, `readFile` and `customCat`.
  The client's runtime is an atom too, so the protocol is built once, not per
  submit. `main.tsx` wraps the page in `@effect/atom-react`'s
  `RegistryProvider`, which holds the atoms. `App` renders two forms,
  `forms/read-file.tsx` (`ReadFileForm`) and `forms/run-cli.tsx`
  (`RunCliForm`), and passes each its schema, `ReadFile.Request` or the
  generated `CustomCat.Request`, which its react-hook-form resolver uses.
  Each runs its procedure's mutation, which holds an `AsyncResult` of the success
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
