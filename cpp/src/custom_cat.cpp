// custom_cat --input-file=NAME --output-file=NAME
//
// Copies files/NAME to files/NAME, under the working directory, replacing
// the output if it exists. The flags are protocol::CustomCatRequest, read by
// reflect-cpp, which spells its fields in kebab-case. The README lists what
// it prints and its exit codes.

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <exception>
#include <iostream>
#include <rfl/cli.hpp>
#include <rfl/json.hpp>
#include <string>
#include <system_error>

#include "protocol.hpp"

namespace {

using namespace protocol;

constexpr int exit_invalid = 1;
constexpr int exit_io = 3;
constexpr int exit_unexpected = 4;

struct IoFailure {
	IoFailed failed;
};

[[noreturn]] void fail(int error) {
	throw IoFailure{IoFailed{.message = std::generic_category().message(error)}};
}

std::string read_file(const std::string& name) {
	const int fd = ::open(in_files(name).c_str(), O_RDONLY | O_CLOEXEC);
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
mode_t mode_for(const std::filesystem::path& path) {
	struct stat status{};
	if (::stat(path.c_str(), &status) == 0) return status.st_mode & 07777;
	const mode_t mask = ::umask(0);
	::umask(mask);
	return 0666 & ~mask;
}

// Writes a temporary file next to the output and renames it over the
// output, so that a failed write leaves the old output as it was.
void write_file(const std::string& name, const std::string& text) {
	const auto target = in_files(name);
	std::string temporary = (files / ".custom_cat-XXXXXX").string();
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

CustomCatSuccess copy(const CustomCatRequest& request) {
	const std::string text = read_file(request.input_file().value());
	write_file(request.output_file().value(), text);
	return CustomCatSuccess{.bytes_copied = text.size()};
}

}  // namespace

int main(int argc, char* argv[]) {
	try {
		auto request =
			rfl::cli::read<CustomCatRequest, rfl::NoExtraFields>(argc, argv)
				.and_then(CustomCatRules::validate<CustomCatRequest>);
		if (!request) {
			std::cout << rfl::json::write<Wire>(CustomCatOutput(InvalidRequest{
							 .issues = issues(std::move(request).error())}))
					  << "\n";
			return exit_invalid;
		}
		std::cout << rfl::json::write<Wire>(
						 CustomCatOutput(copy(*request)))
				  << "\n";
		return 0;
	} catch (const IoFailure& failure) {
		std::cout << rfl::json::write<Wire>(CustomCatOutput(failure.failed))
				  << "\n";
		return exit_io;
	} catch (const std::exception& unexpected) {
		std::cerr << "custom_cat: " << unexpected.what() << "\n";
		return exit_unexpected;
	}
}
