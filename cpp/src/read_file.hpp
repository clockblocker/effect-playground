#pragma once

#include <filesystem>
#include <variant>

#include "backend_protocol.hpp"

namespace reader {

using ReadFileOutcome = std::variant<backend_protocol::ReadFileSuccess,
									 backend_protocol::ReadFileError>;

// The backend's twin of the BFF's reader: a name that isn't .txt fails with
// NotTxtFile, a missing .txt file with FileNotFound. Any other I/O failure
// throws, and the JSON-RPC layer reports it as a defect.
ReadFileOutcome read_file(const std::filesystem::path& directory,
						  const backend_protocol::ReadFileRequest& request);

}  // namespace reader
