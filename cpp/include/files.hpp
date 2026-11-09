#pragma once

// Reading and writing a file in files/, failing with IoFailed when the
// system does: an operation's executable throws IoFailure, which run()
// prints.

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstddef>
#include <filesystem>
#include <string>
#include <system_error>

#include "protocol/common.hpp"

namespace files {

struct IoFailure {
	protocol::IoFailed failed;
};

[[noreturn]] inline void fail(int error) {
	throw IoFailure{
		protocol::IoFailed{.message = std::generic_category().message(error)}};
}

inline std::string read_file(const std::string& name) {
	const int fd = ::open(protocol::in_files(name).c_str(), O_RDONLY | O_CLOEXEC);
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

// The mode a new file gets, or the output's own if it exists.
inline mode_t mode_for(const std::filesystem::path& path) {
	struct stat status{};
	if (::stat(path.c_str(), &status) == 0) return status.st_mode & 07777;
	const mode_t mask = ::umask(0);
	::umask(mask);
	return 0666 & ~mask;
}

// Writes a temporary file next to the output and renames it over the
// output, so that a failed write leaves the old output as it was.
inline void write_file(const std::string& name, const std::string& text) {
	const auto target = protocol::in_files(name);
	std::string temporary = (protocol::files / ".custom_cat-XXXXXX").string();
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
