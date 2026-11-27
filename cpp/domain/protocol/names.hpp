#pragma once

// A file name's rules that a JSON Schema can say, so that they reach the TS
// form: a field's type carries them, and reflect-cpp both checks them when it
// reads a request and writes them into the schema. What only the files can
// say, such as whether a name exists, is a check of the operation's.

#include <rfl.hpp>
#include <string>

namespace protocol {

using PlainName =
	rfl::PatternValidator<R"(^(?!\.\.?$)[^/\\]*$)", "plain file name">;

// As std::filesystem::path's extension(), for which ".txt" alone has none.
using TxtFile = rfl::PatternValidator<R"(^.+\.txt$)", ".txt file name">;

// A plain .txt file name, 5 to 25 characters, in files/. A field reports the
// first rule it breaks, so "x.md" is too short and no more.
using FileName =
	rfl::Validator<std::string, rfl::CodePoints<rfl::Minimum<5>>,
				   rfl::CodePoints<rfl::Maximum<25>>, PlainName, TxtFile>;

}  // namespace protocol
