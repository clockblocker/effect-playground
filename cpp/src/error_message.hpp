#pragma once

#include <rfl.hpp>
#include <rfl/json.hpp>
#include <string>
#include <string_view>

// An error's message template (see backend_protocol.hpp), filled in.
namespace error_message {

// "backend_protocol::NotTxtFile" → "NotTxtFile".
template <class T>
std::string unqualified_name() {
	const std::string name = rfl::type_name_t<T>().str();
	const auto separator = name.rfind("::");
	return separator == std::string::npos ? name : name.substr(separator + 2);
}

// NotTxtFile{.file = "a.md"} → "\"a.md\" is not a .txt file". A string field
// goes in as it is, any other as JSON. A `{field}` the struct doesn't have
// stays as written; the generator rejects it before it gets this far.
template <class Error>
std::string fill(const Error& error) {
	const auto fields = rfl::to_generic(error).to_object();
	std::string message;
	std::string_view rest = Error::message;
	while (true) {
		const auto open = rest.find('{');
		const auto close = rest.find('}', open);
		if (open == std::string_view::npos || close == std::string_view::npos) {
			return message + std::string(rest);
		}
		message += rest.substr(0, open);
		const std::string field(rest.substr(open + 1, close - open - 1));
		const auto value = fields ? fields->get(field)
								  : rfl::Result<rfl::Generic>(fields.error());
		if (!value) {
			message += rest.substr(open, close - open + 1);
		} else if (const auto text = value->to_string()) {
			message += *text;
		} else {
			message += rfl::json::write(*value);
		}
		rest = rest.substr(close + 1);
	}
}

}  // namespace error_message
