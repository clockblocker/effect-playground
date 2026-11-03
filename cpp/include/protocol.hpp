#pragma once

// What the C++ and TypeScript sides share. Edit it and run
// `bun run generate`, which writes `cpp/protocol.schema.json` and
// `src/shared/generated/protocol.ts`.
//
// - `Procedures` lists the procedures. A procedure's `payload` and `success`
//   become `Request` and `Success` in a TypeScript namespace named after it.
//   Its `error` is InvalidRequest, then any error that isn't about a field,
//   such as IoFailed, whose `message` template names its fields.
// - A field's `rfl::Description` becomes its JSDoc.
// - A request's field carries its rules in its type, a Checked<…> (see
//   checked.hpp). Each failing rule becomes an Issue with the rule's message,
//   in which `{value}` stands for the field's value and `{limit}` for the
//   rule's limit. A missing field is a `Missing` issue.
// - A rule across fields lives on the request, in its `Rules` (see
//   validate.hpp), and names the field its issue goes on.

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

// A field name, as on the wire, or an index into an array.
using PathSegment = std::variant<std::string, int>;

struct Issue {
	rfl::Description<"What is wrong, in a sentence.", std::string> message;
	rfl::Description<"Where in the request the problem is: a field, such as "
					 "[\"files\", 2, \"input\"], or [] for the request "
					 "as a whole.",
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
	static constexpr std::string_view name = "Missing";
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
	static constexpr std::string_view name = "TooShort";
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
	static constexpr std::string_view name = "TooLong";
	static constexpr std::string_view message =
		"Must be at most {limit} characters long";
	static constexpr std::size_t limit = N;
	using Schema = rfl::Size<rfl::Maximum<N>>;
	static bool passes(const std::string& value) {
		return characters(value) <= N;
	}
};

// The name of a file in files/, which never names anything outside it.
struct PlainName {
	static constexpr std::string_view name = "NotPlainName";
	static constexpr std::string_view message = "Must be a file name, not a path";
	using Schema = rfl::PatternValidator<R"(^(?!\.\.?$)[^/\\]*$)", "PlainName">;
	static bool passes(const std::string& value) {
		return static_cast<bool>(Schema::validate(value));
	}
};

struct TxtFile {
	static constexpr std::string_view name = "NotTxtFile";
	static constexpr std::string_view message = "\"{value}\" is not a .txt file";
	static bool passes(const std::string& value) {
		return std::filesystem::path(value).extension() == ".txt";
	}
};

// The directory every file name refers to, under the working directory.
inline const std::filesystem::path files = "files";

// Only for a name PlainName accepts.
inline std::filesystem::path in_files(const std::string& name) {
	return files / name;
}

// Any link is refused, even one that stays in files/: following none is
// simpler than checking where each leads.
struct NotALink {
	static constexpr std::string_view name = "LeavesFiles";
	static constexpr std::string_view message =
		"\"{value}\" is a link, which could lead outside the files directory";
	static bool passes(const std::string& value) {
		namespace fs = std::filesystem;
		std::error_code error;
		const auto path = in_files(value);
		if (fs::is_symlink(fs::symlink_status(path, error))) return false;
		const auto resolved = fs::weakly_canonical(path, error);
		if (error) return true;
		const auto directory = fs::weakly_canonical(files, error);
		return error || resolved.parent_path() == directory;
	}
};

// Anything there passes, even a directory: that isn't about the name.
struct ExistingFile {
	static constexpr std::string_view name = "FileNotFound";
	static constexpr std::string_view message = "\"{value}\" does not exist";
	static bool passes(const std::string& value) {
		std::error_code error;
		const auto status = std::filesystem::status(in_files(value), error);
		return status.type() != std::filesystem::file_type::not_found;
	}
};

// Each refinement only checks a name its base accepts: "x.md" is too short,
// and no more. The rules come first, then what the files say.
using Name = Checked<std::string, MinLength<5>, MaxLength<25>>;
using FileName = Checked<Name, PlainName, TxtFile>;
using InFiles = Checked<FileName, NotALink>;
using Existing = Checked<InFiles, ExistingFile>;

struct ReadFileRequest {
	rfl::Description<"The file to read, such as \"hello.txt\", in the files "
					 "directory.",
					 Existing>
		name;
};

struct ReadFileSuccess {
	rfl::Description<"The whole file, decoded as UTF-8.", std::string> contents;
};

enum class IoOperation { read, write };

// A file couldn't be read or written for a reason that isn't about its name,
// such as a directory where a file should be, or a read-only disk.
struct IoFailed {
	static constexpr std::string_view message =
		"Couldn't {operation} \"{file}\": {reason}";
	rfl::Description<"What was being done to the file.", IoOperation> operation;
	rfl::Description<"The file, as the request names it.", std::string> file;
	rfl::Description<"What the system said, such as \"Is a directory\".",
					 std::string>
		reason;
};

using Error = rfl::TaggedUnion<"_tag", InvalidRequest, IoFailed>;

// Never sent: it names what the procedure takes and returns.
struct ReadFile {
	ReadFileRequest payload;
	ReadFileSuccess success;
	Error error;
};

struct DifferentNames;
struct DifferentFiles;

struct CustomCatRequest {
	rfl::Description<"The file to copy, such as \"hello.txt\", in the files "
					 "directory.",
					 Existing>
		input_file;
	rfl::Description<
		"The file to write the copy to, in the files directory, replacing it "
		"if it exists.",
		InFiles>
		output_file;

	using Rules = std::tuple<DifferentNames, DifferentFiles>;
};

struct DifferentNames {
	static constexpr std::string_view name = "SameAsInput";
	static constexpr std::string_view message = "Must not be the input file";
	static constexpr auto field = &CustomCatRequest::output_file;
	static bool passes(const CustomCatRequest& request) {
		return request.input_file().value() != request.output_file().value();
	}
};

// A hard link: NotALink already refuses symbolic ones.
struct DifferentFiles {
	static constexpr std::string_view name = "SameFileAsInput";
	static constexpr std::string_view message =
		"\"{value}\" is the input file under another name";
	static constexpr auto field = &CustomCatRequest::output_file;
	static bool passes(const CustomCatRequest& request) {
		std::error_code error;
		return !std::filesystem::equivalent(
			in_files(request.input_file().value()),
			in_files(request.output_file().value()), error);
	}
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
