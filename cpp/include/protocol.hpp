#pragma once

// The rules and errors the C++ and TypeScript sides share. Edit the structs
// and run `bun run generate`, which writes `cpp/protocol.schema.json` and
// `src/shared/generated/protocol.ts`, where each struct becomes an Effect
// Schema.
//
// - A procedure's `payload`, `success` and `error` become `Request`, `Success`
//   and `Failure` in a TypeScript namespace named after it.
// - A field's `rfl::Description` becomes its JSDoc, and its `rfl::Size`
//   bounds become Effect length checks.
// - An error is an alternative of a procedure's `error`, tagged by its struct
//   name. Its `static constexpr std::string_view message` is never sent: the
//   schema carries it as `x-message`, `{field}` standing for a field's value,
//   and the generated class fills it in as its `message`.

#include <rfl.hpp>
#include <rfl/json.hpp>
#include <string>
#include <string_view>

namespace protocol {

struct ReadFileRequest {
	rfl::Description<
		"The file to read, such as \"hello.txt\". Only its base name is used, so "
		"a request never leaves the files directory.",
		rfl::Validator<std::string, rfl::Size<rfl::Minimum<5>>,
					   rfl::Size<rfl::Maximum<25>>>>
		name;
};

struct ReadFileSuccess {
	rfl::Description<"The whole file, decoded as UTF-8.", std::string> contents;
};

struct NotTxtFile {
	static constexpr std::string_view message = "\"{file}\" is not a .txt file";
	rfl::Description<"The requested name, which does not end in .txt.",
					 std::string>
		file;
};

struct FileNotFound {
	static constexpr std::string_view message = "\"{file}\" does not exist";
	rfl::Description<"The requested name; no such .txt file exists.",
					 std::string>
		file;
};

using ReadFileError = rfl::TaggedUnion<"_tag", NotTxtFile, FileNotFound>;

// Never sent: it names what the procedure takes, returns and fails with.
struct ReadFile {
	ReadFileRequest payload;
	ReadFileSuccess success;
	ReadFileError error;
};

}  // namespace protocol
