// custom_cat --input-file=NAME --output-file=NAME
//
// Copies files/NAME to files/NAME, under the working directory, replacing
// the output if it exists. The flags are protocol::CustomCatRequest, read by
// reflect-cpp, which spells its fields in kebab-case.
//
// Exit codes:
//   0  copied: CustomCatSuccess on stdout, as JSON
//   1  NotTxtFile or FileNotFound: the tagged error on stdout, as JSON, and
//      its message on stderr
//   2  bad arguments, such as a missing flag or a name out of bounds:
//      reflect-cpp's error on stderr
//   3  anything else, such as a directory named x.txt: on stderr

#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <rfl/cli.hpp>
#include <rfl/json.hpp>
#include <sstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <variant>

#include "error_message.hpp"
#include "protocol.hpp"

namespace {

using namespace protocol;

constexpr int exit_error = 1;
constexpr int exit_usage = 2;
constexpr int exit_defect = 3;

const std::filesystem::path files = "files";

std::variant<CustomCatSuccess, CustomCatError> copy(
	const CustomCatRequest& request) {
	const std::string& input = request.input_file().value();
	const std::string& output = request.output_file().value();
	for (const auto& name : {input, output}) {
		if (std::filesystem::path(name).extension() != ".txt") {
			return NotTxtFile{.file = name};
		}
	}
	const auto from = files / std::filesystem::path(input).filename();
	const auto to = files / std::filesystem::path(output).filename();

	std::error_code error;
	const auto status = std::filesystem::status(from, error);
	if (status.type() == std::filesystem::file_type::not_found) {
		return FileNotFound{.file = input};
	}
	if (error || status.type() != std::filesystem::file_type::regular) {
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
	const auto request =
		rfl::cli::read<CustomCatRequest, rfl::NoExtraFields>(argc, argv);
	if (!request) {
		std::cerr << "custom_cat: " << request.error().what() << "\n";
		return exit_usage;
	}
	try {
		const auto outcome = copy(*request);
		if (const auto* success = std::get_if<CustomCatSuccess>(&outcome)) {
			std::cout << rfl::json::write<Wire>(*success) << "\n";
			return 0;
		}
		const auto& failure = std::get<CustomCatError>(outcome);
		std::cout << rfl::json::write<Wire>(failure) << "\n";
		std::cerr << "custom_cat: "
				  << rfl::visit(
						 [](const auto& error) {
							 return error_message::fill(error);
						 },
						 failure)
				  << "\n";
		return exit_error;
	} catch (const std::exception& defect) {
		std::cerr << "custom_cat: " << defect.what() << "\n";
		return exit_defect;
	}
}
