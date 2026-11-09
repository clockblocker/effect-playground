#include "operations/custom_cat.hpp"

#include <string>

#include "files.hpp"

namespace custom_cat {

using protocol::CustomCatRequest;

rfl::Result<CustomCatRequest> check(const CustomCatRequest& request) {
	const std::string& input = request.input_file().value();
	const std::string& output = request.output_file().value();

	protocol::FieldIssues issues;
	if (auto link = files::link_issue(input)) {
		issues.add("input_file", *link);
	} else if (auto missing = files::missing_issue(input)) {
		issues.add("input_file", *missing);
	}
	if (auto link = files::link_issue(output)) {
		issues.add("output_file", *link);
	}
	if (!issues.empty()) return issues.error();

	if (input == output) {
		return protocol::error_on("output_file", "Must not be the input file");
	}
	// A hard link: link_issue already refuses symbolic ones.
	if (files::same_file(input, output)) {
		return protocol::error_on(
			"output_file", "\"" + output + "\" is the input file under another name");
	}
	return request;
}

protocol::CustomCatSuccess copy(const CustomCatRequest& request) {
	const std::string text = files::read_file(request.input_file().value());
	files::write_file(request.output_file().value(), text);
	return {.bytes_copied = text.size()};
}

}  // namespace custom_cat
