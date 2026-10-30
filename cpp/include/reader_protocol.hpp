#pragma once

// The reader protocol: the single source of truth for what crosses the wire
// between the Bun server and this C++ reader.
//
// To change it, edit the structs below and run `bun run generate`. That
// rebuilds this project, writes `cpp/protocol.schema.json` and regenerates
// `src/shared/generated/reader-protocol.ts`, where every struct becomes an
// Effect Schema of the same name.
//
// - A field's `rfl::Description` becomes the JSDoc on the TS field.
// - A string's `rfl::Size` bounds become `minLength` / `maxLength`, then
//   Effect length checks. reflect-cpp rejects a request that breaks one, and
//   so does every Effect boundary that decodes the generated schema. C++ counts
//   UTF-8 bytes and Effect counts code points, which agree for ASCII names.
// - An error is a struct listed in `ReadFile::error`. Its struct name is the
//   `_tag` both sides match on.
// - An error's `static constexpr std::string_view message` is what a person
//   reads when it happens, with `{field}` standing for that field's value. A
//   static member isn't a field, so it never crosses the wire: the schema
//   carries it as `x-message`, and the generated class gets a `message`
//   getter that fills it in. This reader fills it in for the message of its
//   JSON-RPC error. The generator fails on an error without one, or on a
//   `{field}` the struct doesn't have.

#include <rfl.hpp>
#include <rfl/json.hpp>
#include <string>
#include <string_view>

namespace reader_protocol {

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

// The errors ReadFile can fail with, tagged by struct name in `_tag`.
using ReadFileError = rfl::TaggedUnion<"_tag", NotTxtFile, FileNotFound>;

// The procedure itself. Never sent: its struct name is the JSON-RPC method,
// and its fields say what the method takes, returns and fails with.
struct ReadFile {
	ReadFileRequest payload;
	ReadFileSuccess success;
	ReadFileError error;
};

}  // namespace reader_protocol
