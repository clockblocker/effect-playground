// custom_cat --input-file=NAME --output-file=NAME
//
// Copies files/NAME to files/NAME, under the working directory, replacing
// the output if it exists. The flags are protocol::CustomCatRequest, read by
// reflect-cpp, which spells its fields in kebab-case. Exit codes:
//   0  copied: CustomCatSuccess on stdout, as JSON
//   1  a field is wrong: InvalidRequest on stdout, as JSON, with every issue
//   2  a usage error that names no field, such as an unknown flag: on stderr
//   3  anything else, such as a directory named x.txt: on stderr

#include <exception>
#include <fstream>
#include <iostream>
#include <rfl/cli.hpp>
#include <rfl/json.hpp>
#include <sstream>
#include <stdexcept>
#include <string>

#include "protocol.hpp"
#include "validate.hpp"

namespace {

using namespace protocol;

constexpr int exit_invalid = 1;
constexpr int exit_usage = 2;
constexpr int exit_defect = 3;

CustomCatSuccess copy(const CustomCatRequest& request) {
	const auto from = in_files(request.input_file().value());
	const auto to = in_files(request.output_file().value());
	if (!std::filesystem::is_regular_file(from)) {
		throw std::runtime_error("cannot read " + from.string());
	}

	// All of it first, so that copying a file onto itself keeps it.
	std::ifstream source(from, std::ios::binary);
	std::ostringstream contents;
	contents << source.rdbuf();
	if (!source) throw std::runtime_error("cannot read " + from.string());
	const std::string text = contents.str();

	std::ofstream target(to, std::ios::binary | std::ios::trunc);
	target << text;
	target.close();
	if (!target) throw std::runtime_error("cannot write " + to.string());
	return CustomCatSuccess{.bytes_copied = text.size()};
}

}  // namespace

int main(int argc, char* argv[]) {
	// A missing flag parses too, so that validate() reports it.
	const auto request =
		rfl::cli::read<CustomCatRequest, rfl::NoExtraFields,
					   rfl::DefaultIfMissing>(argc, argv);
	if (!request) {
		std::cerr << "custom_cat: " << request.error().what() << "\n";
		return exit_usage;
	}
	try {
		if (auto issues = validate::validate(*request); !issues.empty()) {
			std::cout << rfl::json::write<Wire>(
							 Error(InvalidRequest{.issues = std::move(issues)}))
					  << "\n";
			return exit_invalid;
		}
		std::cout << rfl::json::write<Wire>(copy(*request)) << "\n";
		return 0;
	} catch (const std::exception& defect) {
		std::cerr << "custom_cat: " << defect.what() << "\n";
		return exit_defect;
	}
}
