#pragma once

// custom_wc's check and its work, which the core runs for a CustomWc
// request. Its contract is protocol/custom_wc.hpp; the bodies are in
// src/operations/custom_wc.cpp.

#include <rfl.hpp>

#include "protocol/custom_wc.hpp"

namespace custom_wc {

// What the name's type can't say: the file is there, and isn't a link.
rfl::Result<protocol::CustomWcRequest> check(
	const protocol::CustomWcRequest& request);

// Counts the file's lines, words and bytes, as wc does: a line ends in a
// newline, and a word is a run of characters that aren't whitespace. Throws
// files::IoFailure when the system fails.
protocol::CustomWcSuccess count(const protocol::CustomWcRequest& request);

}  // namespace custom_wc
