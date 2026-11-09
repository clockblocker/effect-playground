#pragma once

// What every operation's output shares, on the wire: an Issue, an
// InvalidRequest of them, and IoFailed; and how a read's or a check's
// failures become issues. The bodies are in src/protocol/wire.cpp.

#include <rfl.hpp>
#include <string>
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

// The message a failure has: an InvalidRequest's joins its issues'.
std::string message_of(const InvalidRequest& error);
std::string message_of(const IoFailed& error);

// An issue per failure in `error`, its message and its path, the fields'
// wire names, such as "inputFile", and an array's indexes as numbers.
std::vector<Issue> issues(rfl::Error&& error);

// The issues a check finds, each on a field by its C++ name, as reflect-cpp
// reports a read's, so that run() reports both alike.
class FieldIssues {
   public:
	void add(std::string field, std::string message);
	bool empty() const noexcept;
	rfl::Unexpected<rfl::Error> error() const;

   private:
	std::vector<rfl::ErrorDetail> details_;
};

// One issue, on the field `name`.
rfl::Unexpected<rfl::Error> error_on(std::string name, std::string message);

}  // namespace protocol
