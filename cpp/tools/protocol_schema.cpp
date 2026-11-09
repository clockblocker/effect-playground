// protocol_schema: prints the JSON Schema of domain/protocol.hpp, which
// reflect-cpp emits.

#include <iostream>
#include <rfl.hpp>
#include <rfl/json.hpp>

#include "domain/protocol.hpp"

int main() {
	const auto document =
		rfl::json::read<rfl::Generic>(
			rfl::json::to_schema<protocol::Procedures, protocol::Wire>())
			.value();
	std::cout << rfl::json::write(document, rfl::json::pretty) << "\n";
}
