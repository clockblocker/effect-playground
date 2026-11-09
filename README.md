# Effect playground

A sandbox for learning Effect. The page has three forms, and each talks to
the BFF over Effect RPC (`effect/rpc`). In the first, type a file name,
submit, and the file's contents come back. In the second, type an input and
an output file, and `custom_cat` copies one to the other. In the third, type
a file name, and `custom_wc` counts its lines, words and bytes. Files live in
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
- the file to read, copy or count exists;
- a copy's output isn't its input, by name or through a hard link.

An issue's `message` is whatever checked the rule says, as it says it: a
reflect-cpp validator's error in `custom_cat`, Effect Schema's message in
the page and the BFF, or the system's error for a file that doesn't exist.
Where nothing says anything, the check has a plain literal. There are no
message templates and no rule codes, and the errors that aren't issues
follow the same rule.

Who checks the rules depends on the operation:

- `CustomCat`'s and `CustomWc`'s rules live on C++ types, each operation's in
  its own header in `cpp/include/protocol/`. The page's forms check them with
  the TypeScript schemas generated from them (see below), so they show
  Effect's own messages and send nothing that breaks one. The BFF checks a
  request's shape only and leaves the rules to the executable, so every issue
  a copy or a count comes back with is the C++'s, word for word.
- `ReadFile` is the BFF's own, with no C++ step: its DTOs are written in
  TypeScript, in `src/shared/bun-side/read-file/read-file-dtos.ts`, with the
  same name rules as a copy's input, and `BffReader` checks the name with
  them, then the files.

The **BFF** (backend-for-frontend) is a Bun server; it serves the page over
RPC, a REST API (`effect/http-api`) for other clients, and an MCP server
(`effect/ai`) whose two tools, `custom_cat` and `custom_wc`, run the C++
executables of those names.

## What can go wrong

Every way a request can go wrong is in one bucket, and each bucket is one of
the three things an Effect's cause can hold: a `Fail` (a typed error, in the
error channel), a `Die` (a defect) or an `Interrupt`.

| Bucket | What it is | Effect | Type |
|---|---|---|---|
| Shape | a wrong type, a missing or unknown field | `Fail`, or `Die` on RPC | `InvalidRequest` |
| Rule | a value breaks a rule on its own, or against another field | `Fail` | `InvalidRequest` |
| Precondition | a value conflicts with the files: the input is missing, a name is a link, the output is the input | `Fail` | `InvalidRequest` |
| Dependency | a file can't be read or written, or an executable can't run | `Fail` | `IoFailed`, `CliFailed` |
| Transport | the page can't reach the BFF | `Fail` | `RpcClientError` |
| Contract | an executable's output doesn't match the protocol | `Die` | `ContractMismatch` |
| Defect | a bug | `Die` | anything |
| Interruption | the call was abandoned | `Interrupt` | none |

- `IoFailed` is a read or write that failed for a reason that isn't about a
  name, such as a directory named `x.txt` or a read-only `files/`:
  `{ message }`, what the system said about the errno. The executables say
  `Is a directory` (`std::generic_category()`), and the BFF's reader
  `illegal operation on a directory` (`getSystemErrorMessage`). Each
  operation declares its own, as it does its `InvalidRequest`:
  `CustomCat.IoFailed` and `CustomWc.IoFailed` from C++, `ReadFile.IoFailed`
  in its DTOs.
- `CliFailed` is the BFF failing to run an executable to its end:
  `{ message }`. It's the spawner's own message when the executable doesn't
  start, such as
  `NotFound: ChildProcess.spawn (…/custom_cat --input-file=… --output-file=…)`,
  the signal's when it's killed,
  `Process interrupted due to receipt of signal: 'SIGKILL'`, and
  `custom_cat timed out after 5000 ms` after five seconds, by default. Only
  the BFF sees it, so it's declared in TS, in `src/shared/helpers/cli-failed.ts`.
- `ContractMismatch` is the BFF and an executable disagreeing: output that
  doesn't decode, such as an issue at a path no request has (an unknown
  flag: the BFF built the flags), output whose tag isn't its exit code's, or
  an exit code the executables don't have.
  It carries the exit code, stdout, stderr and the issue, and the BFF logs
  it where it happens. It stays a defect: no caller can act on it.
- A timeout is `CliFailed` to the caller; inside the runner it interrupts
  the run, which kills the executable, as an abandoned call does.

How each surfaces:

| Bucket | RPC (the page) | REST | MCP |
|---|---|---|---|
| Shape | a raw request gets a `Die` | 422, the `InvalidRequest` as JSON | a tool error from McpServer: `Invalid parameters for tool 'custom_cat': …` |
| Rule, Precondition | `InvalidRequest`: each issue under its field; the form shows a rule's issue in Effect's words and sends nothing | 422, the `InvalidRequest` as JSON | a tool error, a line per issue: `outputFile: Must not be the input file` |
| Dependency | the error's `message` as the root message | `IoFailed` 500, `CliFailed` 503, as JSON | a tool error whose text is the `message` |
| Transport | `Request failed: ` and its cause, such as `Transport error (POST …/rpc/)` | | |
| Contract, Defect | `Something went wrong.` | an empty 500 | `Tool execution failed due to an internal server error.` |
| Interruption | nothing | | |

The BFF logs every defect: the CLI runner a `ContractMismatch`, the RPC
handlers the rest, which RpcServer sends without logging, and HttpApi and
McpServer their own.

Shape is a `Die` on RPC because `RpcServer` decodes the payload before any
handler or middleware runs, and a payload that doesn't decode becomes a
defect with the schema's message, with no hook to turn it into a typed
error. So each method's payload schema is its `RequestShape`, the request's
fields with their types and no rules: a payload that breaks a rule decodes,
and the handler answers it with the method's `InvalidRequest`, the
executable's for a copy or a count and `BffReader`'s for a read. Only a payload of the wrong shape
dies, which the page's client never sends, since it encodes the payload
with the same schema. The REST body and the MCP tool's parameters are
`RequestShape`s too.

HttpApi has the hook: `HttpApiMiddleware.layerSchemaErrorTransform`. A
middleware on the copy endpoint turns a body that doesn't decode into
`CustomCat.InvalidRequest`, and one on the count endpoint into
`CustomWc.InvalidRequest`, their issues from
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
[reflect-cpp](https://github.com/munich-data-engineering/reflect-cpp) from
GitHub, at a commit on `main` after v0.27.1, the first with
`rfl::Error::details()`, with the yyjson it bundles; nothing else is
installed.

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

- RPC, which the page uses: `ReadFile({ name })`,
  `CustomCat({ inputFile, outputFile })` and `CustomWc({ file })`, all over
  `POST /rpc`.
- REST, for other clients: `GET /api/files/read/:name`,
  `POST /api/files/copy`, whose JSON body is `CustomCat.RequestShape`, and
  `POST /api/files/count`, whose body is `CustomWc.RequestShape`. A client
  HttpApi derives from `BffApi` calls them as
  `client.files.read({ params: { name } })`,
  `client.files.copy({ payload })` and `client.files.count({ payload })`. An `InvalidRequest` is a 422 whose body
  is its JSON, such as
  `{"_tag":"InvalidRequest","issues":[{"message":"Expected a string matching the RegExp ^.+\\.txt$","path":["name"]}]}`.
- MCP, for MCP clients: the `custom_cat` and `custom_wc` tools, over
  Streamable HTTP at `/mcp`, protocol 2025-11-25 or 2025-06-18. Their
  parameters are each operation's `RequestShape`; an `InvalidRequest` comes
  back as a tool error whose text has a line per issue, its field first:
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

## The C++ operations

Each C++ operation is an executable in `cpp/build/`, working in `files/`
under its working directory:

```sh
custom_cat --input-file=hello.txt --output-file=copy.txt
custom_wc --file=hello.txt
```

- `custom_cat` copies one `.txt` file to another, replacing the output if it
  exists. It writes a temporary file next to the output and renames it over
  the output, so a write that fails leaves the old output as it was, and
  removes the temporary file. One killed mid-copy can leave a
  `.custom_cat-…` file, which no request can name. Both names follow the
  read's rules, and only the input must exist.
- `custom_wc` counts a `.txt` file's lines, words and bytes, as `wc` does: a
  line ends in a newline, and a word is a run of characters that aren't
  whitespace. `{"_tag":"Success","lines":2,"words":7,"bytes":40}`.

Each `main` is one call to `protocol::run` (`cpp/include/run.hpp`) with the
operation's request, cross-field rules and work; reading and writing files
is in `cpp/include/files.hpp`. Its flags are the fields of the request,
which reflect-cpp's CLI reader (`rfl/cli.hpp`) spells in kebab-case. What it
prints, and its exit codes, the same for every operation:

- 0: stdout is the success, such as `{"_tag":"Success","bytesCopied":18}`.
- 1, the flags are wrong: stdout is the `InvalidRequest`, with every
  issue, such as
  `{"_tag":"InvalidRequest","issues":[{"message":"String 'config.json' did not match format '.txt file name': '^.+\\.txt$'.","path":["inputFile"]},{"message":"String 'x.json' did not match format '.txt file name': '^.+\\.txt$'.","path":["outputFile"]}]}`.
  A missing flag is an issue on its field, in reflect-cpp's words:
  `Field named 'output-file' not found.`, and an unknown one an issue under
  its own name, `["verbose"]`, which no `Path` has.
- 3, a file couldn't be read or written: stdout is the `IoFailed`, such as
  `{"_tag":"IoFailed","message":"Is a directory"}`.
- 4, anything else, which would be a bug in the executable: on stderr.

stdout, on 0, 1 and 3, is one of the operation's outputs, a tagged union
declared in C++, such as `CustomCatOutput`, which is `CustomCat.Output` in
TS: `Success`, `InvalidRequest` or `IoFailed`. The BFF runs each with one
runner, `cliRunner` (`src/server/cpp-side/cli.ts`): the request's fields
become its flags, `--input-file=…`, it runs in a scope whose end kills it
(`SIGTERM`, then `SIGKILL` a second later), and its stdout is decoded once
with the operation's `Output` and checked against the exit code's tag. A
success comes back without its tag, and a failure fails. Exit 4 is a defect;
any other code, output that doesn't decode, or a tag that isn't its exit
code's is a `ContractMismatch`. Each operation's service is a few lines
over it: `CustomCatCli` and `CustomWcCli`, whose
`layerWith({ directory, binary, timeout })` sets where it runs, which
executable it runs and how long it may take; the tests point `binary` at
shell scripts.

## The protocol

Each C++ operation has a header of its own, `cpp/include/protocol/custom_cat.hpp`
and `custom_wc.hpp`, which declares its request and output; what they share
is in `cpp/include/protocol/common.hpp`. `cpp/include/protocol.hpp`
includes them all and lists them in `Procedures`, which is what the
generator reads. A procedure's `output` is a tagged union of its success,
whose `using Tag = rfl::Literal<"Success">` names it, `InvalidRequest`, a
list of `Issue`s, which are structs there too, and `IoFailed`, whose one
field is its `message`. Fields are snake_case in C++ and camelCase in JSON,
through reflect-cpp's `SnakeCaseToCamelCase` (`protocol::Wire`).

A field carries its rules in its type, an `rfl::Validator` of reflect-cpp
validators: reflect-cpp's own where it has one, and otherwise a struct with
reflect-cpp's validator interface, `static rfl::Result<T> validate(T)`:

```cpp
using PlainName =
	rfl::PatternValidator<R"(^(?!\.\.?$)[^/\\]*$)", "plain file name">;
using TxtFile = rfl::PatternValidator<R"(^.+\.txt$)", ".txt file name">;
struct NotALink {
	static rfl::Result<std::string> validate(const std::string& name);
};
template <class... More>
using InFilesName =
	rfl::Validator<std::string,
				   Checks<CodePoints<rfl::Minimum<5>>,
						  CodePoints<rfl::Maximum<25>>, PlainName, TxtFile,
						  NotALink, More...>>;
using InFiles = InFilesName<>;
using Existing = InFilesName<ExistingFile>;
```

An issue's message is the validator's error as reflect-cpp reports it:

| Rule | Validator | Message |
|---|---|---|
| valid UTF-8 | `CodePoints<…>` | `String is not valid UTF-8.` |
| 5 or more characters | `CodePoints<rfl::Minimum<5>>` | `Code point count validation failed: Value expected to be greater than or equal to 5, but got 4.` |
| 25 or fewer | `CodePoints<rfl::Maximum<25>>` | `Code point count validation failed: Value expected to be less than or equal to 25, but got 27.` |
| a plain name | `PlainName` | `String '../x.txt' did not match format 'plain file name': '^(?!\.\.?$)[^/\\]*$'.` |
| `.txt` | `TxtFile` | `String 'config.json' did not match format '.txt file name': '^.+\.txt$'.` |
| not a link | `NotALink` | `"out.txt" is a link, which could lead outside the files directory` |
| exists | `ExistingFile` | the `std::error_code`'s message: `No such file or directory` |
| present | none: reflect-cpp's read | `Field named 'output-file' not found.` |
| not the input | `DifferentNames` | `Must not be the input file` |
| not a hard link to the input | `DifferentFiles` | `"same.txt" is the input file under another name` |

`CodePoints<V>` is `rfl::Size<V>` counting a string's code points, not its
bytes, with `Size`'s schema: JSON Schema's `minLength` and `maxLength`, and
so the form, count code points too, so both sides take the same names. The
comparison and its words are the wrapped `rfl::Minimum` or `rfl::Maximum`'s.

`Checks<…>` is `rfl::AllOf`, which stops at a field's first rule that fails,
so `x.md` is too short and nothing else, and the rules come before what the
files say. It differs only in its schema, which leaves out the validators
that have none, `NotALink` and `ExistingFile`: `rfl::AllOf` wants one from
each. A copy's `input_file` and a count's `file` are `Existing`, and a
copy's `output_file` `InFiles`, so only the files read must exist.

A rule across fields is a validator of the request, which puts its error on
a field with `error_on`:

```cpp
struct DifferentNames {
	static rfl::Result<CustomCatRequest> validate(
		const CustomCatRequest& request);  // error_on("output_file", …)
};
using CustomCatRules = rfl::AllOf<DifferentNames, DifferentFiles>;
```

`run` reads the request with reflect-cpp, which runs every field's rules and
fails with each that does, then the operation's rules, in order, which stop
at the first that fails. Either way the read's `rfl::Error` lists each
failure in `details()`, a message and a path, and `protocol::issues` makes
each an `Issue`, its path the fields' wire names, `["inputFile"]`, and an
array's indexes as numbers.

`bun run generate` (`scripts/generate.ts`) writes, under
`src/shared/generated/`, a directory per operation under the side that
serves it, and `generated.ts`, an index of the operations' namespaces,
which everything imports from:

```
src/shared/generated/
  generated.ts
  bun-side/read-file/read-file-namespace.ts
  cpp-side/custom-cat/custom-cat-dtos.ts
  cpp-side/custom-cat/custom-cat-namespace.ts
  cpp-side/custom-wc/custom-wc-dtos.ts
  cpp-side/custom-wc/custom-wc-namespace.ts
```

1. reflect-cpp turns the structs into JSON Schema: `cpp/build/protocol_schema`
   writes `cpp/protocol.schema.json`. A validator with a schema becomes its
   keyword: `CodePoints` `minLength` or `maxLength`, a `PatternValidator` a
   `pattern`; `NotALink` and `ExistingFile` have none.
2. For each C++ operation, the generator writes its DTOs,
   `custom-cat-dtos.ts`: what it takes, succeeds with and fails with, as the
   C++ declares them, and nothing else. `Request` is the payload, `Success`
   the output's first alternative without its tag, any other struct they use
   keeps its name, each error besides `InvalidRequest` is a
   `Schema.TaggedError` of its fields, whose `message` field is its message,
   and `Errors` lists those. Each keyword becomes Effect's check, with
   Effect's own message: `Schema.isMinCodePoints(5)`,
   `Schema.isPattern(/^.+\.txt$/u)`. A bun-side operation's DTOs are
   written by hand, in the same shape, as
   `src/shared/bun-side/<operation>/<operation>-dtos.ts`, which the
   generator finds by that name.
3. For every operation, from either side, it writes the namespace consumers
   use, `custom-cat-namespace.ts`, named after the operation, `CustomCat`:
   each DTO with its type, then what it derives from the request's JSON
   Schema, `RequestShape`, the request without its checks, nested structs
   inlined, and `Path`, the union of every field's path and `[]`, the whole
   request, such as `readonly ["inputFile"] | readonly ["outputFile"] | readonly []`,
   then what every operation builds alike, with the helpers in
   `src/shared/helpers/procedure.ts`: `Issue`, an issue at one of the
   paths, `{ message, path }`, `InvalidRequest`, a `Schema.TaggedError`
   with a non-empty `issues`, whose `message` joins theirs, `Failure`,
   `InvalidRequest` or one of `Errors` (`Failure`, because an `Error` there
   would shadow the global one), and, for a C++ operation, `Output`, what it
   prints, the success tagged. Each name is both the schema and its type, so
   `CustomCat.Success` works in either position, and TypeScript 7 hovers read
   `CustomCat.Success`. Each namespace links to its DTOs, which link to the
   C++ header.
4. The page's forms validate with each operation's `Request`; the RPC
   payloads, the REST bodies and the MCP tools' parameters are their
   `RequestShape`s.

Nothing is shared between operations: each declares every struct and error
it uses, so `CustomCat.IoFailed` and `CustomWc.IoFailed` are two classes
with one tag.

`BffReader` decodes a read's name with `ReadFile.Request.fields.name`, and a
name it rejects is an issue with the decode's message, such as
`Expected a string with at least 5 code points`. Then it refuses a link, a
literal, `"out.txt" is a link, which could lead outside the files directory`,
and a file that doesn't exist with the system's message,
`no such file or directory`. `src/shared/rest-api.ts` gives every
`InvalidRequest` 422, every `IoFailed` 500 and `CliFailed` 503.

`fieldOf(path)` (`src/shared/helpers/field-of.ts`) turns any operation's
path into react-hook-form's field name, typed: `fieldOf(["inputFile"])` is
`"inputFile"`, a path `["files", number, "input"]` is
`` `files.${number}.input` ``.

After changing the structs or a bun-side operation's DTOs, run
`bun run generate`: it rebuilds the C++, re-emits the schema and
regenerates the TypeScript. Both outputs are committed.
`bun run generate:check` fails if either is stale, or if
`src/shared/generated/` holds a file or directory the generator no longer
writes. The generator fails on a C++ operation with no header of its own,
on an Issue with more than `message` and `path`, on an output that isn't a
tagged success, then `InvalidRequest`, then tagged errors, and on an
error's field that would shadow the `Error`'s own, such as `name`.

## Checks

```sh
bun run check            # tsc
bun run lint             # biome; bun run fix formats
bun run knip
bun run test             # builds the C++; runs the executables, the BFF and the forms' matching
bun run generate:check
```

The tests that run the C++ skip when `cmake` isn't on the PATH.
`test/protocol-types.test.ts` holds the
type tests, which `bun run check` runs.

## Layout

- `cpp/` holds the protocol, a header per operation in `include/protocol/`,
  `run.hpp` and `files.hpp`, which every executable uses, the executables,
  and the tool that emits the schema. `cpp/build/` is ignored.
- `src/shared/` is the contract the page and the BFF import: the REST API
  (`BffApi`), the RPC group (`BffRpcs`), the bun-side operations' DTOs in
  `bun-side/`, the generated protocol, and `helpers/`: `CliFailed`,
  `fieldOf`, `withStatus` and `procedure.ts`, what every namespace builds
  alike.
- `src/server/` is the BFF: `bun-side/` holds `BffReader`, `cpp-side/` the
  CLI runner and a service per C++ operation, `CustomCatCli` and
  `CustomWcCli`, and `protocols/` the three transports, which `main.ts`
  mounts on one router.
- `src/client/` builds the RPC client as `AtomRpc` atoms (`effect/reactivity`),
  `BffRpcClient`, with a mutation per procedure, `readFile`, `customCat` and
  `customWc`.
  The client's runtime is an atom too, so the protocol is built once, not per
  submit. `main.tsx` wraps the page in `@effect/atom-react`'s
  `RegistryProvider`, which holds the atoms. `App` renders three forms,
  `forms/read-file.tsx` (`ReadFileForm`), `forms/run-cli.tsx` (`RunCliForm`)
  and `forms/count.tsx` (`CountForm`), and passes each its schema,
  `ReadFile.Request`, `CustomCat.Request` or `CustomWc.Request`, which its
  react-hook-form resolver uses.
  Each runs its procedure's mutation, which holds an `AsyncResult` of the success
  struct, failing with exactly the procedure's `Failure` (and `CliFailed`, for
  a C++ operation) or the client's `RpcClientError`:
  `Atom.Failure<typeof customCat>`. `forms/shared.tsx` holds what they all
  use: the resolver hook, a text field with its error under it,
  `FormFailure`, any mutation's failure, `setIssues`
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
