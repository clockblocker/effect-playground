#pragma once

// A file name's rules that a JSON Schema can say, so that they reach the TS
// form: a field's type carries them, and reflect-cpp both checks them when it
// reads a request and writes them into the schema. What only the files can
// say, such as whether a name exists, is a check of the operation's.

#include <cstddef>
#include <optional>
#include <rfl.hpp>
#include <string>

namespace protocol {

// The code points of a UTF-8 string, or nothing if it isn't valid UTF-8.
inline std::optional<std::size_t> code_points(const std::string& value) {
	std::size_t count = 0;
	for (std::size_t i = 0; i < value.size(); ++count) {
		const auto lead = static_cast<unsigned char>(value[i]);
		const std::size_t length = lead < 0x80   ? 1
								   : lead < 0xC2 ? 0
								   : lead < 0xE0 ? 2
								   : lead < 0xF0 ? 3
								   : lead < 0xF5 ? 4
												 : 0;
		if (length == 0 || i + length > value.size()) return std::nullopt;
		for (std::size_t j = 1; j < length; ++j) {
			if ((static_cast<unsigned char>(value[i + j]) & 0xC0) != 0x80) {
				return std::nullopt;
			}
		}
		i += length;
	}
	return count;
}

// rfl::Size counts bytes, but the minLength and maxLength its schema emits
// count code points, as the generated TS does. This counts code points, with
// Size's schema.
template <class V>
struct CodePoints {
	static rfl::Result<std::string> validate(const std::string& value) {
		const auto count = code_points(value);
		if (!count) return rfl::error("String is not valid UTF-8.");
		return V::validate(*count)
			.transform([&](const auto&) { return value; })
			.transform_error([](const rfl::Error& error) {
				return rfl::Error("Code point count validation failed: " +
								  error.what());
			});
	}

	template <class T>
	static rfl::parsing::schema::ValidationType to_schema() {
		return rfl::Size<V>::template to_schema<T>();
	}
};

using PlainName =
	rfl::PatternValidator<R"(^(?!\.\.?$)[^/\\]*$)", "plain file name">;

// As std::filesystem::path's extension(), for which ".txt" alone has none.
using TxtFile = rfl::PatternValidator<R"(^.+\.txt$)", ".txt file name">;

// A plain .txt file name, 5 to 25 characters, in files/. A field reports the
// first rule it breaks, so "x.md" is too short and no more.
using FileName =
	rfl::Validator<std::string, CodePoints<rfl::Minimum<5>>,
				   CodePoints<rfl::Maximum<25>>, PlainName, TxtFile>;

}  // namespace protocol
