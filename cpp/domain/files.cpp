#include "domain/files.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstddef>
#include <filesystem>
#include <system_error>

namespace files {

namespace {

const std::filesystem::path directory = "files";

std::filesystem::path path_of(const std::string& name) {
	return directory / name;
}

[[noreturn]] void fail(int error) {
	throw IoFailure{
		protocol::IoFailed{.message = std::generic_category().message(error)}};
}

// The mode a new file gets, or the output's own if it exists.
mode_t mode_for(const std::filesystem::path& path) {
	struct stat status{};
	if (::stat(path.c_str(), &status) == 0) return status.st_mode & 07777;
	const mode_t mask = ::umask(0);
	::umask(mask);
	return 0666 & ~mask;
}

}  // namespace

std::optional<std::string> link_issue(const std::string& name) {
	namespace fs = std::filesystem;
	std::error_code error;
	const auto path = path_of(name);
	const auto leaves = [&] {
		if (fs::is_symlink(fs::symlink_status(path, error))) return true;
		const auto resolved = fs::weakly_canonical(path, error);
		if (error) return false;
		const auto inside = fs::weakly_canonical(directory, error);
		return !error && resolved.parent_path() != inside;
	};
	if (!leaves()) return std::nullopt;
	return "\"" + name +
		   "\" is a link, which could lead outside the files directory";
}

std::optional<std::string> missing_issue(const std::string& name) {
	std::error_code error;
	const auto status = std::filesystem::status(path_of(name), error);
	if (status.type() != std::filesystem::file_type::not_found) {
		return std::nullopt;
	}
	return error.message();
}

bool same_file(const std::string& first, const std::string& second) {
	std::error_code error;
	return std::filesystem::equivalent(path_of(first), path_of(second), error);
}

std::string read_file(const std::string& name) {
	const int fd = ::open(path_of(name).c_str(), O_RDONLY | O_CLOEXEC);
	if (fd < 0) fail(errno);
	std::string text;
	char buffer[1 << 16];
	while (true) {
		const auto count = ::read(fd, buffer, sizeof buffer);
		if (count == 0) break;
		if (count < 0) {
			if (errno == EINTR) continue;
			const int error = errno;
			::close(fd);
			fail(error);
		}
		text.append(buffer, static_cast<std::size_t>(count));
	}
	::close(fd);
	return text;
}

// Writes a temporary file next to the output and renames it over the
// output, so that a failed write leaves the old output as it was.
void write_file(const std::string& name, const std::string& text) {
	const auto target = path_of(name);
	std::string temporary = (directory / ".custom_cat-XXXXXX").string();
	const int fd = ::mkstemp(temporary.data());
	if (fd < 0) fail(errno);
	const auto give_up = [&](int error) {
		::close(fd);
		::unlink(temporary.c_str());
		fail(error);
	};
	if (::fchmod(fd, mode_for(target)) != 0) give_up(errno);
	for (std::size_t written = 0; written < text.size();) {
		const auto count =
			::write(fd, text.data() + written, text.size() - written);
		if (count < 0) {
			if (errno == EINTR) continue;
			give_up(errno);
		}
		written += static_cast<std::size_t>(count);
	}
	if (::fsync(fd) != 0) give_up(errno);
	if (::close(fd) != 0) {
		const int error = errno;
		::unlink(temporary.c_str());
		fail(error);
	}
	if (::rename(temporary.c_str(), target.c_str()) != 0) {
		const int error = errno;
		::unlink(temporary.c_str());
		fail(error);
	}
}

}  // namespace files
