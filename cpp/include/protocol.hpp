#pragma once

// What the C++ and TypeScript sides share. Edit it and run
// `bun run generate`, which writes `cpp/protocol.schema.json` and
// `src/shared/generated/protocol.ts`.
//
// - `Procedures` lists the procedures. A procedure's `payload` and `success`
//   become `Request` and `Success` in a TypeScript namespace named after it.
//   Its only error is InvalidRequest.
// - A field's `rfl::Description` becomes its JSDoc.
// - A request's field carries its rules in its type, a Checked<…> (see
//   checked.hpp). Each failing rule becomes an Issue, with the rule's code and
//   its message, in which `{value}` stands for the field's value and
//   `{limit}` for the rule's limit. A missing field is a `Missing` issue.

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <rfl.hpp>
#include <rfl/json.hpp>
#include <string>
#include <string_view>
#include <system_error>
#include <tuple>
#include <variant>
#include <vector>

#include "checked.hpp"

namespace protocol {

// snake_case here, camelCase in JSON: the schema, custom_cat's output and an
// issue's path all pass it.
using Wire = rfl::SnakeCaseToCamelCase;

// Every way a field of a request can be wrong, each produced by one rule:
//   Missing       the field is absent                     Present
//   TooShort      fewer characters than the minimum       MinLength
//   TooLong       more characters than the maximum        MaxLength
//   NotTxtFile    the name doesn't end in .txt            TxtFile
//   FileNotFound  no such file in files/                  ExistingFile
enum class IssueCode { Missing, TooShort, TooLong, NotTxtFile, FileNotFound };

// A field name, as on the wire, or an index into an array.
using PathSegment = std::variant<std::string, int>;

struct Issue {
	rfl::Description<"What is wrong.", IssueCode> code;
	rfl::Description<"What is wrong, in a sentence.", std::string> message;
	rfl::Description<"Where the field is in the request, such as "
					 "[\"files\", 2, \"input\"].",
					 std::vector<PathSegment>>
		path;
};

struct InvalidRequest {
	rfl::Description<
		"Every problem with the request's fields, one per failed rule.",
		rfl::Validator<std::vector<Issue>, rfl::Size<rfl::Minimum<1>>>>
		issues;
};

// The rule validate() applies to an absent field.
struct Present {
	static constexpr IssueCode code = IssueCode::Missing;
	static constexpr std::string_view message = "Required";
};

// Counts code points, as JSON Schema's minLength and maxLength do.
inline std::size_t characters(const std::string& value) {
	std::size_t count = 0;
	for (const unsigned char byte : value) count += (byte & 0xC0) != 0x80;
	return count;
}

template <std::size_t N>
struct MinLength {
	static constexpr IssueCode code = IssueCode::TooShort;
	static constexpr std::string_view message =
		"Must be at least {limit} characters long";
	static constexpr std::size_t limit = N;
	using Schema = rfl::Size<rfl::Minimum<N>>;
	static bool passes(const std::string& value) {
		return characters(value) >= N;
	}
};

template <std::size_t N>
struct MaxLength {
	static constexpr IssueCode code = IssueCode::TooLong;
	static constexpr std::string_view message =
		"Must be at most {limit} characters long";
	static constexpr std::size_t limit = N;
	using Schema = rfl::Size<rfl::Maximum<N>>;
	static bool passes(const std::string& value) {
		return characters(value) <= N;
	}
};

struct TxtFile {
	static constexpr IssueCode code = IssueCode::NotTxtFile;
	static constexpr std::string_view message = "\"{value}\" is not a .txt file";
	static bool passes(const std::string& value) {
		return std::filesystem::path(value).extension() == ".txt";
	}
};

// The directory every file name refers to, under the working directory.
inline const std::filesystem::path files = "files";

// Only the base name counts, so a name never leaves files/.
inline std::filesystem::path in_files(const std::string& name) {
	return files / std::filesystem::path(name).filename();
}

// Anything there passes, even a directory: that isn't about the name.
struct ExistingFile {
	static constexpr IssueCode code = IssueCode::FileNotFound;
	static constexpr std::string_view message = "\"{value}\" does not exist";
	static bool passes(const std::string& value) {
		std::error_code error;
		const auto status = std::filesystem::status(in_files(value), error);
		return status.type() != std::filesystem::file_type::not_found;
	}
};

// Each refinement only checks a name its base accepts: "x.md" is too short,
// and no more.
using Name = Checked<std::string, MinLength<5>, MaxLength<25>>;
using FileName = Checked<Name, TxtFile>;
using Existing = Checked<FileName, ExistingFile>;

struct ReadFileRequest {
	rfl::Description<
		"The file to read, such as \"hello.txt\". Only its base name is used, so "
		"a request never leaves the files directory.",
		Existing>
		name;
};

struct ReadFileSuccess {
	rfl::Description<"The whole file, decoded as UTF-8.", std::string> contents;
};

using Error = rfl::TaggedUnion<"_tag", InvalidRequest>;

// Never sent: it names what the procedure takes and returns.
struct ReadFile {
	ReadFileRequest payload;
	ReadFileSuccess success;
	Error error;
};

struct CustomCatRequest {
	rfl::Description<
		"The file to copy, such as \"hello.txt\". Only its base name is used, so "
		"a request never leaves the files directory.",
		Existing>
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

struct CustomCat {
	CustomCatRequest payload;
	CustomCatSuccess success;
	Error error;
};

using Procedures = std::tuple<ReadFile, CustomCat>;

}  // namespace protocol
