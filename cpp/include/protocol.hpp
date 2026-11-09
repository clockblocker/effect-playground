#pragma once

// The operations the C++ serves, each an executable whose contract is a
// header of its own in protocol/: what it takes and prints, with the name
// rules in protocol/names.hpp and what every output shares in
// protocol/wire.hpp. Edit them and run `bun run generate`, which writes
// `cpp/protocol.schema.json` and, for each operation,
// `src/shared/generated/cpp-side/<operation>/`.
//
// An operation's `payload` is its request, the executable's flags, and its
// `output` what it prints: a tagged union of its success, InvalidRequest,
// then any error that isn't about a field.

#include <tuple>

#include "protocol/custom_cat.hpp"
#include "protocol/custom_wc.hpp"

namespace protocol {

using Procedures = std::tuple<CustomCat, CustomWc>;

}  // namespace protocol
