// protocol_schema: prints the JSON Schema of domain/protocol.hpp, which
// reflect-cpp emits.

#include <iostream>
#include <rfl.hpp>
#include <rfl/json.hpp>

#include "domain/protocol.hpp"

int main() {
	std::cout << rfl::json::to_schema<protocol::Procedures, protocol::Wire,
									  rfl::NoExtraFields>(rfl::json::pretty)
			  << "\n";
}
