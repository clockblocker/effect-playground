#pragma once

// custom_cat: copies one file in files/ to another.

#include <cstdint>
#include <filesystem>
#include <rfl.hpp>
#include <string>
#include <system_error>

#include "common.hpp"

namespace protocol {

struct CustomCatRequest {
	rfl::Description<"The file to copy, such as \"hello.txt\", in the files "
					 "directory.",
					 Existing>
		input_file;
	rfl::Description<
		"The file to write the copy to, in the files directory, replacing it "
		"if it exists.",
		InFiles>
		output_file;
};

struct DifferentNames {
	static rfl::Result<CustomCatRequest> validate(
		const CustomCatRequest& request) {
		if (request.input_file().value() == request.output_file().value()) {
			return error_on("output_file", "Must not be the input file");
		}
		return request;
	}
};

// A hard link: NotALink already refuses symbolic ones.
struct DifferentFiles {
	static rfl::Result<CustomCatRequest> validate(
		const CustomCatRequest& request) {
		const auto& output = request.output_file().value();
		std::error_code error;
		if (std::filesystem::equivalent(in_files(request.input_file().value()),
										in_files(output), error)) {
			return error_on("output_file",
							"\"" + output +
								"\" is the input file under another name");
		}
		return request;
	}
};

// The rules across a request's fields, which run once reflect-cpp has read
// it, every field passing its own, and stop at the first that fails.
using CustomCatRules = rfl::AllOf<DifferentNames, DifferentFiles>;

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
