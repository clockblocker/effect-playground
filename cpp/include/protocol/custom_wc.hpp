#pragma once

// custom_wc's contract: what it takes, as its flags, and what it prints.
// What it checks and does is in src/custom_wc.cpp.

#include <cstdint>
#include <rfl.hpp>

#include "names.hpp"
#include "wire.hpp"

namespace protocol {

struct CustomWcRequest {
	rfl::Description<"The file to count, such as \"hello.txt\", in the files "
					 "directory.",
					 FileName>
		file;
};

struct CustomWcSuccess {
	using Tag = rfl::Literal<"Success">;
	rfl::Description<"How many newlines the file holds.", std::uint64_t> lines;
	rfl::Description<"How many runs of non-space characters it holds.",
					 std::uint64_t>
		words;
	rfl::Description<"How many bytes it holds.", std::uint64_t> bytes;
};

// What custom_wc prints, on exit 0, 1 and 3.
using CustomWcOutput =
	rfl::TaggedUnion<"_tag", CustomWcSuccess, InvalidRequest, IoFailed>;

struct CustomWc {
	CustomWcRequest payload;
	CustomWcOutput output;
};

}  // namespace protocol
