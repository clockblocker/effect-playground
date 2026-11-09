#pragma once

// custom_cat's contract: what it takes, as its flags, and what it prints.
// What it checks and does is in src/custom_cat.cpp.

#include <cstdint>
#include <rfl.hpp>

#include "names.hpp"
#include "wire.hpp"

namespace protocol {

struct CustomCatRequest {
	rfl::Description<"The file to copy, such as \"hello.txt\", in the files "
					 "directory.",
					 FileName>
		input_file;
	rfl::Description<
		"The file to write the copy to, in the files directory, replacing it "
		"if it exists.",
		FileName>
		output_file;
};

struct CustomCatSuccess {
	using Tag = rfl::Literal<"Success">;
	rfl::Description<"How many bytes the output file holds.", std::uint64_t>
		bytes_copied;
};

// What custom_cat prints, on exit 0, 1 and 3.
using CustomCatOutput =
	rfl::TaggedUnion<"_tag", CustomCatSuccess, InvalidRequest, IoFailed>;

struct CustomCat {
	CustomCatRequest payload;
	CustomCatOutput output;
};

}  // namespace protocol
