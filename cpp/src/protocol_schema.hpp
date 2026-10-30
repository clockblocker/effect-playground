#pragma once

#include <string>

namespace protocol_schema {

// The reader protocol's JSON Schema, as reflect-cpp emits it for
// `reader_protocol::ReadFile`, plus each error's message template as
// `"x-message"` on that error's definition. reflect-cpp only describes
// fields, and the template is a static member, so it is added here.
std::string emit();

}  // namespace protocol_schema
