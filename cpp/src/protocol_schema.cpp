// protocol_schema: prints the JSON Schema of protocol.hpp, which reflect-cpp
// emits, plus "x-issues": each issue code's message template, and for a rule
// with a Schema, the keyword that carries its limit, such as "minLength";
// and "x-errors": the message template of each error that has one, by tag.
// reflect-cpp only describes fields, and the rules live on types.

#include <iostream>
#include <map>
#include <rfl.hpp>
#include <rfl/json.hpp>
#include <stdexcept>
#include <string>
#include <tuple>
#include <type_traits>

#include "protocol.hpp"
#include "validate.hpp"

namespace {

using rfl::Generic;

Generic::Object& object(Generic& value, std::string_view what) {
	auto* result = std::get_if<Generic::Object>(&value.variant());
	if (result == nullptr) {
		throw std::runtime_error(std::string(what) + " is not an object");
	}
	return *result;
}

// The one keyword besides "type" in the schema of a string with just this
// rule's constraint: {"type":"string","minLength":5} → "minLength".
template <class Rule>
std::string keyword() {
	auto schema =
		rfl::json::read<Generic>(
			rfl::json::to_schema<rfl::Validator<std::string, typename Rule::Schema>>())
			.value();
	std::string found;
	for (const auto& [key, _] : object(schema, "a rule's schema")) {
		if (key == "$schema" || key == "$defs" || key == "type") continue;
		if (!found.empty()) throw std::runtime_error("two keywords: " + key);
		found = key;
	}
	if (found.empty()) throw std::runtime_error("a rule's Schema has no keyword");
	return found;
}

using Templates = std::map<std::string, Generic::Object>;

template <class Request>
void add_templates(Templates& templates) {
	validate::for_each_rule<Request>([&]<class Rule>() {
		const auto code = rfl::enum_to_string(Rule::code);
		Generic::Object entry;
		entry["message"] = std::string(Rule::message);
		if constexpr (checked::HasSchema<Rule>) entry["keyword"] = keyword<Rule>();
		const auto [at, added] = templates.emplace(code, entry);
		if (!added && rfl::json::write(at->second) != rfl::json::write(entry)) {
			throw std::runtime_error(code + " has two message templates");
		}
	});
}

template <class... Procedures>
Generic::Object issues(std::type_identity<std::tuple<Procedures...>>) {
	Templates templates;
	(add_templates<decltype(Procedures::payload)>(templates), ...);
	Generic::Object result;
	for (const auto& [code, name] : rfl::get_enumerator_array<protocol::IssueCode>()) {
		const auto entry = templates.find(std::string(code));
		if (entry == templates.end()) {
			throw std::runtime_error(std::string(code) + " has no rule");
		}
		result[std::string(code)] = entry->second;
	}
	return result;
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
	object(document, "the schema")["x-issues"] =
		issues(std::type_identity<Procedures>());
	object(document, "the schema")["x-errors"] =
		errors(std::type_identity<Procedures>());
	std::cout << rfl::json::write(document, rfl::json::pretty) << "\n";
}
