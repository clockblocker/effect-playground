#include "protocol_schema.hpp"

#include <rfl.hpp>
#include <rfl/json.hpp>
#include <stdexcept>
#include <string_view>
#include <type_traits>

#include "backend_protocol.hpp"

namespace protocol_schema {
namespace {

using rfl::Generic;

Generic::Object& object(Generic& value, std::string_view what) {
	auto* result = std::get_if<Generic::Object>(&value.variant());
	if (result == nullptr) {
		throw std::runtime_error(std::string(what) + " is not an object");
	}
	return *result;
}

// reflect-cpp's $defs key for an alternative of an rfl::TaggedUnion:
// "backend_protocol::NotTxtFile" → "backend_protocol__NotTxtFile__tagged".
template <class Error>
std::string tagged_key() {
	std::string key = rfl::type_name_t<Error>().str();
	for (auto at = key.find("::"); at != std::string::npos;
		 at = key.find("::", at)) {
		key.replace(at, 2, "__");
	}
	return key + "__tagged";
}

// Puts "x-message" right after the definition's "type".
void add_message(Generic::Object& defs, const std::string& key,
				 std::string_view message) {
	if (defs.count(key) == 0) throw std::runtime_error("no definition " + key);
	auto& definition = object(defs[key], key);
	Generic::Object with_message;
	for (const auto& [field, value] : definition) {
		with_message.insert(field, value);
		if (field == "type") {
			with_message.insert(std::string("x-message"),
								Generic(std::string(message)));
		}
	}
	definition = std::move(with_message);
}

template <rfl::internal::StringLiteral discriminator, class... Errors>
void add_messages(Generic::Object& defs,
				  std::type_identity<rfl::TaggedUnion<discriminator, Errors...>>) {
	(add_message(defs, tagged_key<Errors>(), Errors::message), ...);
}

}  // namespace

std::string emit() {
	using backend_protocol::ReadFile;
	auto document =
		rfl::json::read<Generic>(rfl::json::to_schema<ReadFile>()).value();
	auto& defs = object(object(document, "the schema")["$defs"], "$defs");
	add_messages(defs, std::type_identity<decltype(ReadFile::error)>());
	return rfl::json::write(document, rfl::json::pretty);
}

}  // namespace protocol_schema
