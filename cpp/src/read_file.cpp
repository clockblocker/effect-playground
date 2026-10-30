#include "read_file.hpp"

#include <fstream>
#include <sstream>
#include <stdexcept>
#include <system_error>

namespace reader {

using namespace reader_protocol;

ReadFileOutcome read_file(const std::filesystem::path& directory,
						  const ReadFileRequest& request) {
	const std::string& name = request.name().value();
	const std::filesystem::path requested(name);
	if (requested.extension() != ".txt") {
		return ReadFileError(NotTxtFile{.file = name});
	}
	// filename() keeps "../../etc/passwd.txt" inside the files directory.
	const auto path = directory / requested.filename();

	std::error_code error;
	const auto status = std::filesystem::status(path, error);
	if (status.type() == std::filesystem::file_type::not_found) {
		return ReadFileError(FileNotFound{.file = name});
	}
	if (error || status.type() != std::filesystem::file_type::regular) {
		// Permissions, a directory named x.txt: a bug, not a case the client
		// handles.
		throw std::runtime_error("cannot read " + path.string());
	}

	std::ifstream file(path, std::ios::binary);
	if (!file) throw std::runtime_error("cannot open " + path.string());
	std::ostringstream contents;
	contents << file.rdbuf();
	return ReadFileSuccess{.contents = contents.str()};
}

}  // namespace reader
