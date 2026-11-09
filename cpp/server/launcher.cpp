#include "server/launcher.hpp"

#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cstdlib>
#include <cstring>
#include <iostream>

extern char** environ;

namespace server::launcher {

namespace {

const int forwarded_signals[] = {SIGINT, SIGTERM, SIGHUP};

int exit_code(int status) {
	if (WIFEXITED(status)) return WEXITSTATUS(status);
	if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
	return 1;
}

}  // namespace

// Blocks the signals this process waits for, before any thread starts, so
// that they reach sigwait in supervise() and nowhere else.
sigset_t block_waited_signals() {
	sigset_t waited;
	sigemptyset(&waited);
	for (const int signal : forwarded_signals) sigaddset(&waited, signal);
	sigaddset(&waited, SIGCHLD);
	pthread_sigmask(SIG_BLOCK, &waited, nullptr);

	// An ignored signal never becomes pending, so sigwait would miss it:
	// SIGCHLD is ignored by default, and a shell starts background jobs with
	// SIGINT ignored. A no-op handler keeps each one pending until sigwait.
	struct sigaction pending {};
	pending.sa_handler = [](int) {};
	for (const int signal : forwarded_signals) sigaction(signal, &pending, nullptr);
	sigaction(SIGCHLD, &pending, nullptr);
	// A client that hangs up mid-write must not kill the core.
	std::signal(SIGPIPE, SIG_IGN);
	return waited;
}

pid_t spawn(const std::vector<std::string>& command, std::uint16_t port) {
	std::vector<std::string> environment;
	const std::string prefix = std::string(port_variable) + "=";
	for (char** entry = environ; *entry != nullptr; ++entry) {
		if (!std::string_view(*entry).starts_with(prefix)) {
			environment.emplace_back(*entry);
		}
	}
	environment.push_back(prefix + std::to_string(port));

	const auto pointers = [](std::vector<std::string>& strings) {
		std::vector<char*> result;
		for (auto& string : strings) result.push_back(string.data());
		result.push_back(nullptr);
		return result;
	};
	auto arguments = command;
	auto argv = pointers(arguments);
	auto envp = pointers(environment);

	// The child starts with no blocked signals and default handlers.
	posix_spawnattr_t attributes;
	posix_spawnattr_init(&attributes);
	sigset_t none;
	sigemptyset(&none);
	posix_spawnattr_setsigmask(&attributes, &none);
	sigset_t defaults;
	sigemptyset(&defaults);
	for (const int signal : forwarded_signals) sigaddset(&defaults, signal);
	sigaddset(&defaults, SIGCHLD);
	sigaddset(&defaults, SIGPIPE);
	posix_spawnattr_setsigdefault(&attributes, &defaults);
	posix_spawnattr_setflags(&attributes,
							 POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF);

	pid_t child = 0;
	const int error =
		posix_spawnp(&child, argv[0], nullptr, &attributes, argv.data(), envp.data());
	posix_spawnattr_destroy(&attributes);
	if (error != 0) {
		std::cerr << "core: cannot start " << command[0] << ": "
				  << std::strerror(error) << "\n";
		std::exit(127);
	}
	return child;
}

// Waits for signals: forwards SIGINT, SIGTERM and SIGHUP to the child, and
// returns once the child has exited. Without a child, the first one ends it.
int supervise(const sigset_t& waited, pid_t child) {
	while (true) {
		int signal = 0;
		sigwait(&waited, &signal);
		if (signal == SIGCHLD) {
			int status = 0;
			if (child != 0 && waitpid(child, &status, WNOHANG) == child) {
				return exit_code(status);
			}
			continue;
		}
		if (child == 0) return 128 + signal;
		kill(child, signal);
	}
}

}  // namespace server::launcher
