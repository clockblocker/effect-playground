#pragma once

// What every operation's output shares, on the wire: an Issue, an
// InvalidRequest of them, and IoFailed; and how a read's or a check's
// failures become issues.

#include <cctype>
#include <cstddef>
#include <rfl.hpp>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace protocol {

// snake_case here, camelCase in JSON: the schema, an executable's output and
// an issue's path all pass it.
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

// A file couldn't be read or written for a reason that isn't about its name,
// such as a directory where a file should be, or a read-only disk.
struct IoFailed {
	rfl::Description<"What the system said, such as \"Is a directory\".",
					 std::string>
		message;
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

// An issue per failure in `error`, its message and its path.
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

// The issues a check finds, each on a field by its C++ name, as reflect-cpp
// reports a read's, so that run() reports both alike.
class FieldIssues {
   public:
	void add(std::string field, std::string message) {
		details_.push_back(rfl::ErrorDetail{.path = {std::move(field)},
											.message = std::move(message)});
	}

	bool empty() const noexcept { return details_.empty(); }

	rfl::Unexpected<rfl::Error> error() const {
		std::string what;
		for (const auto& detail : details_) {
			what += (what.empty() ? "" : "; ") + detail.message;
		}
		return rfl::error(rfl::Error(std::move(what), details_));
	}

   private:
	std::vector<rfl::ErrorDetail> details_;
};

// One issue, on the field `name`.
inline rfl::Unexpected<rfl::Error> error_on(std::string name,
											std::string message) {
	FieldIssues issues;
	issues.add(std::move(name), std::move(message));
	return issues.error();
}

}  // namespace protocol
