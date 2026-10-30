#include "watchdog.hpp"

#include <fcntl.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cerrno>
#include <csignal>
#include <ctime>
#include <system_error>

namespace watchdog {
namespace {

constexpr int grace_steps = 20;
constexpr long step_nanoseconds = 50'000'000;  // 20 × 50 ms = 1 s

// Reads exactly `size` bytes; false on EOF or error.
bool read_exact(int fd, void* data, std::size_t size) {
	auto* bytes = static_cast<char*>(data);
	while (size > 0) {
		const auto received = ::read(fd, bytes, size);
		if (received < 0 && errno == EINTR) continue;
		if (received <= 0) return false;
		bytes += received;
		size -= static_cast<std::size_t>(received);
	}
	return true;
}

// Blocks until every write end of `fd`'s pipe is closed.
void await_eof(int fd) {
	char byte = 0;
	while (true) {
		const auto received = ::read(fd, &byte, 1);
		if (received < 0 && errno == EINTR) continue;
		if (received <= 0) return;
	}
}

[[noreturn]] void run(int fd) {
	pid_t child = 0;
	// The launcher died before it spawned anything.
	if (!read_exact(fd, &child, sizeof child)) ::_exit(0);
	await_eof(fd);

	::kill(child, SIGTERM);
	const timespec step{.tv_sec = 0, .tv_nsec = step_nanoseconds};
	for (int i = 0; i < grace_steps; ++i) {
		if (::kill(child, 0) != 0) ::_exit(0);
		::nanosleep(&step, nullptr);
	}
	::kill(child, SIGKILL);
	::_exit(0);
}

}  // namespace

Watchdog start() {
	int ends[2];
	if (::pipe(ends) < 0) {
		throw std::system_error(errno, std::generic_category(), "pipe");
	}
	const int read_end = ends[0];
	const int write_end = ends[1];
	// Only the launcher may hold the write end: a child that inherited it
	// would keep the pipe open after the launcher died.
	::fcntl(write_end, F_SETFD, FD_CLOEXEC);

	const pid_t pid = ::fork();
	if (pid < 0) {
		throw std::system_error(errno, std::generic_category(), "fork");
	}
	if (pid == 0) {
		::close(write_end);
		run(read_end);
	}
	::close(read_end);
	return {.pid = pid, .fd = write_end};
}

void watch(const Watchdog& watchdog, pid_t child) {
	const auto* bytes = reinterpret_cast<const char*>(&child);
	std::size_t size = sizeof child;
	while (size > 0) {
		const auto written = ::write(watchdog.fd, bytes, size);
		if (written < 0 && errno == EINTR) continue;
		if (written <= 0) return;
		bytes += written;
		size -= static_cast<std::size_t>(written);
	}
}

void stop(const Watchdog& watchdog) {
	::kill(watchdog.pid, SIGKILL);
	while (::waitpid(watchdog.pid, nullptr, 0) < 0 && errno == EINTR) {
	}
	::close(watchdog.fd);
}

}  // namespace watchdog
