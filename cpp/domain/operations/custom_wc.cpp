#include "domain/operations/custom_wc.hpp"

#include <cctype>
#include <cstdint>
#include <string>
#include <utility>

#include "domain/files.hpp"

namespace custom_wc {

using protocol::CustomWcRequest;

rfl::Result<CustomWcRequest> check(const CustomWcRequest& request) {
	const std::string& file = request.file().value();
	if (auto link = files::link_issue(file)) {
		return rfl::error(
			rfl::Error(std::move(*link), rfl::ErrorKind::constraint_violation)
				.in_field("file"));
	}
	if (auto missing = files::missing_issue(file)) {
		return rfl::error(
			rfl::Error(std::move(*missing), rfl::ErrorKind::constraint_violation)
				.in_field("file"));
	}
	return request;
}

protocol::CustomWcSuccess count(const CustomWcRequest& request) {
	const std::string text = files::read_file(request.file().value());
	std::uint64_t lines = 0;
	std::uint64_t words = 0;
	bool in_word = false;
	for (const unsigned char c : text) {
		if (c == '\n') ++lines;
		const bool space = std::isspace(c) != 0;
		if (!space && !in_word) ++words;
		in_word = !space;
	}
	return {.lines = lines, .words = words, .bytes = text.size()};
}

}  // namespace custom_wc
