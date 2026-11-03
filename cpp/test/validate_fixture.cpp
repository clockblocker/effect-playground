// validate_fixture JSON: reads a Batch from its argument and prints the
// issues validate() finds, as JSON. Only test/validate.test.ts runs it.

#include <iostream>
#include <rfl.hpp>
#include <rfl/json.hpp>
#include <vector>

#include "protocol.hpp"
#include "validate.hpp"

namespace {

struct Pair {
	protocol::Existing input;
	protocol::FileName output_file;
};

struct Batch {
	std::vector<Pair> files;
	rfl::Description<"Rules under a description still run.", protocol::FileName>
		label;
	// Both rules on one level, so both can fail.
	std::vector<Checked<std::string, protocol::MinLength<5>, protocol::TxtFile>>
		tags;
};

}  // namespace

int main(int argc, char* argv[]) {
	if (argc != 2) {
		std::cerr << "usage: validate_fixture JSON\n";
		return 2;
	}
	const auto batch =
		rfl::json::read<Batch, protocol::Wire, rfl::DefaultIfMissing>(argv[1]);
	if (!batch) {
		std::cerr << batch.error().what() << "\n";
		return 2;
	}
	std::cout << rfl::json::write<protocol::Wire>(validate::validate(*batch))
			  << "\n";
}
