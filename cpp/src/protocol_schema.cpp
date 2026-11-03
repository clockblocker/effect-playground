// protocol_schema: prints the JSON Schema of protocol.hpp, which reflect-cpp
// emits, plus "x-errors": the message template of each error that has one,
// by tag, which reflect-cpp doesn't describe.

#include <iostream>
#include <rfl.hpp>
#include <rfl/json.hpp>
#include <stdexcept>
#include <string>
#include <tuple>
#include <type_traits>

#include "protocol.hpp"

namespace {

using rfl::Generic;

Generic::Object& object(Generic& value, std::string_view what) {
	auto* result = std::get_if<Generic::Object>(&value.variant());
	if (result == nullptr) {
		throw std::runtime_error(std::string(what) + " is not an object");
	}
	return *result;
}

template <class Error>
void add_error(Generic::Object& errors) {
	if constexpr (requires { Error::message; }) {
		Generic::Object entry;
		entry["message"] = std::string(Error::message);
		errors[rfl::internal::tag_t<"_tag", Error>().str()] = entry;
	}
}

template <rfl::internal::StringLiteral discriminator, class... Errors>
void add_errors(std::type_identity<rfl::TaggedUnion<discriminator, Errors...>>,
				Generic::Object& errors) {
	(add_error<Errors>(errors), ...);
}

template <class... Procedures>
Generic::Object errors(std::type_identity<std::tuple<Procedures...>>) {
	Generic::Object result;
	(add_errors(std::type_identity<decltype(Procedures::error)>(), result), ...);
	return result;
}

}  // namespace

int main() {
	using protocol::Procedures;
	auto document = rfl::json::read<Generic>(
						rfl::json::to_schema<Procedures, protocol::Wire>())
						.value();
	object(document, "the schema")["x-errors"] =
		errors(std::type_identity<Procedures>());
	std::cout << rfl::json::write(document, rfl::json::pretty) << "\n";
}
