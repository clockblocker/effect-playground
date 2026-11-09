#pragma once

// custom_wc's contract: what it takes, and what it answers.
// What it checks and does is in domain/operations/custom_wc.hpp.

#include <cstdint>
#include <rfl.hpp>

#include "domain/protocol/names.hpp"
#include "domain/protocol/wire.hpp"

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

// What custom_wc answers: its success, or what it fails with.
using CustomWcOutput =
	rfl::TaggedUnion<"_tag", CustomWcSuccess, InvalidRequest, IoFailed>;

struct CustomWc {
	CustomWcRequest payload;
	CustomWcOutput output;
};

}  // namespace protocol
