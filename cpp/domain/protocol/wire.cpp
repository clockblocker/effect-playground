#include "domain/protocol/wire.hpp"

#include <cctype>
#include <cstddef>
#include <string_view>
#include <utility>

namespace protocol {

namespace {

// A field's name on the wire: reflect-cpp's CLI reader spells input_file
// input-file, and its path segments with it.
std::string wire_name(std::string_view name) {
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

}  // namespace

std::string message_of(const InvalidRequest& error) {
	std::string message;
	for (const auto& issue : error.issues().value()) {
		message += (message.empty() ? "" : "; ") + issue.message();
	}
	return message;
}

std::string message_of(const IoFailed& error) { return error.message(); }

std::vector<Issue> issues(rfl::Error&& error) {
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

}  // namespace protocol
