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
// - A request's field carries its rules in its type, a Checked<…> of
//   reflect-cpp validators (see checked.hpp). Each failing validator becomes
//   an Issue whose message is the validator's own error.
// - A rule across fields lives on the request, in its `Rules` (see
//   validate.hpp), and names the field its issue goes on.

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

using PlainName =
	rfl::PatternValidator<R"(^(?!\.\.?$)[^/\\]*$)", "plain file name">;

// As std::filesystem::path's extension(), for which ".txt" alone has none.
using TxtFile = rfl::PatternValidator<R"(^.+\.txt$)", ".txt file name">;

// The directory every file name refers to, under the working directory.
inline const std::filesystem::path files = "files";

// Only for a name PlainName accepts.
inline std::filesystem::path in_files(const std::string& name) {
	return files / name;
}

// Any link is refused, even one that stays in files/: following none is
// simpler than checking where each leads.
struct NotALink {
	static rfl::Result<std::string> validate(const std::string& name) {
		namespace fs = std::filesystem;
		std::error_code error;
		const auto path = in_files(name);
		const auto leaves = [&] {
			if (fs::is_symlink(fs::symlink_status(path, error))) return true;
			const auto resolved = fs::weakly_canonical(path, error);
			if (error) return false;
			const auto directory = fs::weakly_canonical(files, error);
			return !error && resolved.parent_path() != directory;
		};
		if (leaves()) {
			return rfl::error("\"" + name +
							  "\" is a link, which could lead outside the files "
							  "directory");
		}
		return name;
	}
};

// Anything there passes, even a directory: that isn't about the name.
struct ExistingFile {
	static rfl::Result<std::string> validate(const std::string& name) {
		std::error_code error;
		const auto status = std::filesystem::status(in_files(name), error);
		if (status.type() == std::filesystem::file_type::not_found) {
			return rfl::error(error.message());
		}
		return name;
	}
};

// Each refinement only checks a name its base accepts: "x.md" is too short,
// and no more. The rules come first, then what the files say.
using Name = Checked<std::string, rfl::Size<rfl::Minimum<5>>,
					 rfl::Size<rfl::Maximum<25>>>;
using FileName = Checked<Name, PlainName, TxtFile>;
using InFiles = Checked<FileName, NotALink>;
using Existing = Checked<InFiles, ExistingFile>;

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
	static constexpr auto field = &CustomCatRequest::output_file;
	static rfl::Result<CustomCatRequest> validate(
		const CustomCatRequest& request) {
		if (request.input_file().value() == request.output_file().value()) {
			return rfl::error("Must not be the input file");
		}
		return request;
	}
};

// A hard link: NotALink already refuses symbolic ones.
struct DifferentFiles {
	static constexpr auto field = &CustomCatRequest::output_file;
	static rfl::Result<CustomCatRequest> validate(
		const CustomCatRequest& request) {
		const auto& output = request.output_file().value();
		std::error_code error;
		if (std::filesystem::equivalent(in_files(request.input_file().value()),
										in_files(output), error)) {
			return rfl::error("\"" + output +
							  "\" is the input file under another name");
		}
		return request;
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

using Procedures = std::tuple<CustomCat>;

}  // namespace protocol
