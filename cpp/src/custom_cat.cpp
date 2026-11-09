// custom_cat --input-file=NAME --output-file=NAME
//
// Copies files/NAME to files/NAME, under the working directory, replacing
// the output if it exists. The flags are protocol::CustomCatRequest; run()
// reads them and prints the output, and the README lists its exit codes.

#include "files.hpp"
#include "protocol/custom_cat.hpp"
#include "run.hpp"

namespace {

protocol::CustomCatSuccess copy(const protocol::CustomCatRequest& request) {
	const std::string text = files::read_file(request.input_file().value());
	files::write_file(request.output_file().value(), text);
	return {.bytes_copied = text.size()};
}

}  // namespace

int main(int argc, char* argv[]) {
	return protocol::run<protocol::CustomCatOutput, protocol::CustomCatRequest,
						 protocol::CustomCatRules>(argc, argv, copy);
}
