#pragma once

// What the C++ and TypeScript sides share. Edit it and run
// `bun run generate`, which writes `cpp/protocol.schema.json` and
// `src/shared/generated/protocol.ts`.
//
// - `Procedures` lists the procedures. A procedure's `payload` becomes
//   `Request` in a TypeScript namespace named after it, and its `output`,
//   what it prints, `Output`: a tagged union of its success, which becomes
//   `Success`, InvalidRequest, then any error that isn't about a field.
// - A field's `rfl::Description` becomes its JSDoc.
// - A request's field carries its rules in its type, an rfl::Validator of
//   Checks<…>. reflect-cpp reads a request with them, and each failure it
//   reports, rfl::Error::details(), becomes an Issue (see issues()).
// - A rule across fields is a validator of the request, in its rfl::AllOf
//   such as CustomCatRules, that puts its error on a field (see error_on()).

#include <cctype>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <rfl.hpp>
#include <rfl/json.hpp>
#include <string>
#include <string_view>
#include <system_error>
#include <tuple>
#include <utility>
#include <variant>
#include <vector>

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

// A field's name on the wire: reflect-cpp's CLI reader spells input_file
// input-file, and its path segments with it.
inline std::string wire_name(std::string_view name) {
	std::string wire;
	bool upper = false;
	for (const char c : name) {
		if (c == '-' || c == '_') {
			upper = true;
		} else {
			wire += upper ? static_cast<char>(std::toupper(c)) : c;
			upper = false;
		}
	}
	return wire;
}

// An issue per failure reflect-cpp reports, its message and its path.
inline std::vector<Issue> issues(rfl::Error&& error) {
	std::vector<Issue> issues;
	for (auto& detail : std::move(error).details()) {
		std::vector<PathSegment> path;
		for (const auto& segment : detail.path) {
			if (const auto* name = std::get_if<std::string>(&segment)) {
				path.emplace_back(wire_name(*name));
			} else {
				path.emplace_back(static_cast<int>(std::get<std::size_t>(segment)));
			}
		}
		issues.push_back(
			Issue{.message = std::move(detail.message), .path = std::move(path)});
	}
	return issues;
}

// An error that reflect-cpp reports on the field `name`, for a rule across
// fields.
inline rfl::Unexpected<rfl::Error> error_on(std::string name,
											std::string message) {
	return rfl::error(rfl::Error(
		message, {rfl::ErrorDetail{.path = {std::move(name)}, .message = message}}));
}

template <class Validator, class T>
concept HasSchema = requires { Validator::template to_schema<T>(); };

// rfl::AllOf, which stops at the first validator that fails, but whose JSON
// Schema leaves out the validators that have none, such as NotALink:
// reflect-cpp's own wants one from each.
template <class... Validators>
struct Checks {
	template <class T>
	static rfl::Result<T> validate(T value) noexcept {
		return rfl::AllOf<Validators...>::validate(std::move(value));
	}

	template <class T>
	static rfl::parsing::schema::ValidationType to_schema() {
		using ValidationType = rfl::parsing::schema::ValidationType;
		std::vector<ValidationType> types;
		(
			[&] {
				if constexpr (HasSchema<Validators, T>) {
					types.push_back(Validators::template to_schema<T>());
				}
			}(),
			...);
		if (types.size() == 1) return types.front();
		return ValidationType{ValidationType::AllOf{.types_ = std::move(types)}};
	}
};

// The code points of a UTF-8 string, or nothing if it isn't valid UTF-8.
inline std::optional<std::size_t> code_points(const std::string& value) {
	std::size_t count = 0;
	for (std::size_t i = 0; i < value.size(); ++count) {
		const auto lead = static_cast<unsigned char>(value[i]);
		const std::size_t length = lead < 0x80   ? 1
								   : lead < 0xC2 ? 0
								   : lead < 0xE0 ? 2
								   : lead < 0xF0 ? 3
								   : lead < 0xF5 ? 4
												 : 0;
		if (length == 0 || i + length > value.size()) return std::nullopt;
		for (std::size_t j = 1; j < length; ++j) {
			if ((static_cast<unsigned char>(value[i + j]) & 0xC0) != 0x80) {
				return std::nullopt;
			}
		}
		i += length;
	}
	return count;
}

// rfl::Size counts bytes, but the minLength and maxLength its schema emits
// count code points, as the generated TS does. This counts code points, with
// Size's schema.
template <class V>
struct CodePoints {
	static rfl::Result<std::string> validate(const std::string& value) {
		const auto count = code_points(value);
		if (!count) return rfl::error("String is not valid UTF-8.");
		return V::validate(*count)
			.transform([&](const auto&) { return value; })
			.transform_error([](const rfl::Error& error) {
				return rfl::Error("Code point count validation failed: " +
								  error.what());
			});
	}

	template <class T>
	static rfl::parsing::schema::ValidationType to_schema() {
		return rfl::Size<V>::template to_schema<T>();
	}
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

// A name in files/, with its rules in order: a field reports the first that
// fails, so "x.md" is too short and no more, and the rules come before what
// the files say.
template <class... More>
using InFilesName =
	rfl::Validator<std::string,
				   Checks<CodePoints<rfl::Minimum<5>>,
						  CodePoints<rfl::Maximum<25>>, PlainName, TxtFile,
						  NotALink, More...>>;
using InFiles = InFilesName<>;
using Existing = InFilesName<ExistingFile>;

// A file couldn't be read or written for a reason that isn't about its name,
// such as a directory where a file should be, or a read-only disk.
struct IoFailed {
	rfl::Description<"What the system said, such as \"Is a directory\".",
					 std::string>
		message;
};

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
};

struct DifferentNames {
	static rfl::Result<CustomCatRequest> validate(
		const CustomCatRequest& request) {
		if (request.input_file().value() == request.output_file().value()) {
			return error_on("output_file", "Must not be the input file");
		}
		return request;
	}
};

// A hard link: NotALink already refuses symbolic ones.
struct DifferentFiles {
	static rfl::Result<CustomCatRequest> validate(
		const CustomCatRequest& request) {
		const auto& output = request.output_file().value();
		std::error_code error;
		if (std::filesystem::equivalent(in_files(request.input_file().value()),
										in_files(output), error)) {
			return error_on("output_file",
							"\"" + output +
								"\" is the input file under another name");
		}
		return request;
	}
};

// The rules across a request's fields, which run once reflect-cpp has read
// it, every field passing its own, and stop at the first that fails.
using CustomCatRules = rfl::AllOf<DifferentNames, DifferentFiles>;

struct CustomCatSuccess {
	using Tag = rfl::Literal<"Success">;
	rfl::Description<"How many bytes the output file holds.", std::uint64_t>
		bytes_copied;
};

// What custom_cat prints, on exit 0, 1 and 3.
using CustomCatOutput =
	rfl::TaggedUnion<"_tag", CustomCatSuccess, InvalidRequest, IoFailed>;

struct CustomCat {
	CustomCatRequest payload;
	CustomCatOutput output;
};

using Procedures = std::tuple<CustomCat>;

}  // namespace protocol
