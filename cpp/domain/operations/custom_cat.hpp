#pragma once

// custom_cat's check and its work, which the core runs for a CustomCat
// request. Its contract is protocol/custom_cat.hpp; the bodies are in
// custom_cat.cpp.

#include <rfl.hpp>

#include "domain/protocol/custom_cat.hpp"

namespace custom_cat {

// What the names' types can't say. Each name on its own first, every field
// at once; then the two together, once each passes.
rfl::Result<protocol::CustomCatRequest> check(
	const protocol::CustomCatRequest& request);

// Copies the input to the output, replacing it; throws files::IoFailure
// when the system fails.
protocol::CustomCatSuccess copy(const protocol::CustomCatRequest& request);

}  // namespace custom_cat
