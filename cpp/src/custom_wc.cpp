// custom_wc --file=NAME
//
// Counts the lines, words and bytes of files/NAME, under the working
// directory, as wc does: a line ends in a newline, and a word is a run of
// characters that aren't whitespace. The flags are protocol::CustomWcRequest;
// run() reads them and prints the output, with custom_cat's exit codes.

#include <cctype>
#include <cstdint>
#include <string>

#include "files.hpp"
#include "protocol/custom_wc.hpp"
#include "run.hpp"

namespace {

protocol::CustomWcSuccess count(const protocol::CustomWcRequest& request) {
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

}  // namespace

int main(int argc, char* argv[]) {
	return protocol::run<protocol::CustomWcOutput, protocol::CustomWcRequest>(
		argc, argv, count);
}
