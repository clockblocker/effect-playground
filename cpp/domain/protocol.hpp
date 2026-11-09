#pragma once

// The operations the core serves, each with a contract of its own in
// protocol/: what it takes and answers, with the name rules in
// protocol/names.hpp and what every answer shares in protocol/wire.hpp. Its
// check and its work are in operations/. Edit them and run
// `bun run generate`, which writes `cpp/protocol.schema.json` and, for each
// operation, `src/shared/generated/cpp-side/<operation>/`.
//
// An operation's `payload` is its request, and its `output` what it
// answers: a tagged union of its success, InvalidRequest, then any error
// that isn't about a field.

#include <tuple>

#include "domain/protocol/custom_cat.hpp"
#include "domain/protocol/custom_wc.hpp"

namespace protocol {

using Procedures = std::tuple<CustomCat, CustomWc>;

}  // namespace protocol
