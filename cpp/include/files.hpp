#pragma once

// Everything the executables do with the disk, all in files/ under the
// working directory, and only for a name protocol::FileName accepts. The
// bodies are in src/files.cpp.

#include <optional>
#include <string>

#include "protocol/wire.hpp"

namespace files {

// What a check asks of a name before an operation runs: each is the message
// of an issue on the name's field if the answer is no.

// Any link is refused, even one that stays in files/: following none is
// simpler than checking where each leads.
std::optional<std::string> link_issue(const std::string& name);

// In the system's words. Anything there passes, even a directory: that
// isn't about the name, and reading it fails with IoFailed.
std::optional<std::string> missing_issue(const std::string& name);

// Whether two names are one file, such as through a hard link.
bool same_file(const std::string& first, const std::string& second);

// What an operation does with the files: each throws IoFailure, which run()
// prints as IoFailed, when the system fails.

struct IoFailure {
	protocol::IoFailed failed;
};

std::string read_file(const std::string& name);

// Replaces the file, or makes it: a write that fails leaves the old one as
// it was.
void write_file(const std::string& name, const std::string& text);

}  // namespace files
