#pragma once

#include <filesystem>
#include <variant>

#include "reader_protocol.hpp"

namespace reader {

using ReadFileOutcome = std::variant<reader_protocol::ReadFileSuccess,
									 reader_protocol::ReadFileError>;

// The C++ twin of the Bun reader: a name that isn't .txt fails with
// NotTxtFile, a missing .txt file with FileNotFound. Any other I/O failure
// throws, and the JSON-RPC layer reports it as a defect.
ReadFileOutcome read_file(const std::filesystem::path& directory,
						  const reader_protocol::ReadFileRequest& request);

}  // namespace reader
