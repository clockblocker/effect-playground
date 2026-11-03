#pragma once

// The rules and errors the C++ and TypeScript sides share. Edit the structs
// and run `bun run generate`, which writes `cpp/protocol.schema.json` and
// `src/shared/generated/protocol.ts`, where each struct becomes an Effect
// Schema.
//
// - `Procedures` lists the procedures. A procedure's `payload`, `success`
//   and `error` become `Request`, `Success` and `Failure` in a TypeScript
//   namespace named after it.
// - A field's `rfl::Description` becomes its JSDoc, and its `rfl::Size`
//   bounds become Effect length checks.
// - An error is an alternative of a procedure's `error`, tagged by its struct
//   name. Its `static constexpr std::string_view message` is never sent: the
//   schema carries it as `x-message`, `{field}` standing for a field's value,
//   and the generated class fills it in as its `message`.

#include <rfl.hpp>
#include <rfl/json.hpp>
#include <cstdint>
#include <string>
#include <string_view>
#include <tuple>

namespace protocol {

// snake_case here, camelCase in JSON: the schema and custom_cat's output both
// pass it.
using Wire = rfl::SnakeCaseToCamelCase;

// A name in the files directory, for every procedure that takes one.
using FileName = rfl::Validator<std::string, rfl::Size<rfl::Minimum<5>>,
								rfl::Size<rfl::Maximum<25>>>;

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

struct ReadFileRequest {
	rfl::Description<
		"The file to read, such as \"hello.txt\". Only its base name is used, so "
		"a request never leaves the files directory.",
		FileName>
		name;
};

struct ReadFileSuccess {
	rfl::Description<"The whole file, decoded as UTF-8.", std::string> contents;
};

// Never sent: it names what the procedure takes, returns and fails with.
struct ReadFile {
	ReadFileRequest payload;
	ReadFileSuccess success;
	rfl::TaggedUnion<"_tag", NotTxtFile, FileNotFound> error;
};

struct CustomCatRequest {
	rfl::Description<
		"The file to copy, such as \"hello.txt\". Only its base name is used, so "
		"a request never leaves the files directory.",
		FileName>
		input_file;
	rfl::Description<
		"The file to write the copy to, replacing it if it exists. Only its "
		"base name is used, as for the input.",
		FileName>
		output_file;
};

struct CustomCatSuccess {
	rfl::Description<"How many bytes the output file holds.", std::uint64_t>
		bytes_copied;
};

using CustomCatError = rfl::TaggedUnion<"_tag", NotTxtFile, FileNotFound>;

struct CustomCat {
	CustomCatRequest payload;
	CustomCatSuccess success;
	CustomCatError error;
};

using Procedures = std::tuple<ReadFile, CustomCat>;

}  // namespace protocol
