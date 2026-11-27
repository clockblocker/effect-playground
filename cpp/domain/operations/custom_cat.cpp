#include "domain/operations/custom_cat.hpp"

#include <string>
#include <utility>
#include <vector>

#include "domain/files.hpp"

namespace custom_cat {

using protocol::CustomCatRequest;

rfl::Result<CustomCatRequest> check(const CustomCatRequest& request) {
	const std::string& input = request.input_file().value();
	const std::string& output = request.output_file().value();

	std::vector<rfl::Error> errors;
	if (auto link = files::link_issue(input)) {
		errors.push_back(
			rfl::Error(std::move(*link), rfl::ErrorKind::constraint_violation)
				.in_field("input_file"));
	} else if (auto missing = files::missing_issue(input)) {
		errors.push_back(
			rfl::Error(std::move(*missing), rfl::ErrorKind::constraint_violation)
				.in_field("input_file"));
	}
	if (auto link = files::link_issue(output)) {
		errors.push_back(
			rfl::Error(std::move(*link), rfl::ErrorKind::constraint_violation)
				.in_field("output_file"));
	}
	if (!errors.empty()) {
		return rfl::error(rfl::Error::combine(std::move(errors)));
	}

	if (input == output) {
		return rfl::error(
			rfl::Error("Must not be the input file",
					   rfl::ErrorKind::constraint_violation)
				.in_field("output_file"));
	}
	// A hard link: link_issue already refuses symbolic ones.
	if (files::same_file(input, output)) {
		return rfl::error(
			rfl::Error("\"" + output + "\" is the input file under another name",
					   rfl::ErrorKind::constraint_violation)
				.in_field("output_file"));
	}
	return request;
}

protocol::CustomCatSuccess copy(const CustomCatRequest& request) {
	const std::string text = files::read_file(request.input_file().value());
	files::write_file(request.output_file().value(), text);
	return {.bytes_copied = text.size()};
}

}  // namespace custom_cat
