// core: the C++ core, which serves the operations, and launches the BFF
// that calls them.
//
//   core [-- COMMAND...]
//       Serves the operations over JSON-RPC on 127.0.0.1, on
//       $EFFECT_PLAYGROUND_CORE_PORT or an ephemeral port, in files/ under
//       its working directory. With a COMMAND, it spawns it with the port in
//       $EFFECT_PLAYGROUND_CORE_PORT, forwards SIGINT, SIGTERM and SIGHUP to
//       it, and exits with its status. If the core itself dies, a watchdog
//       stops the child (see core/watchdog.hpp). Without a COMMAND, it
//       serves until signalled.

#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include <csignal>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core/operation.hpp"
#include "core/tcp_server.hpp"
#include "core/watchdog.hpp"
#include "operations/custom_cat.hpp"
#include "operations/custom_wc.hpp"
#include "protocol.hpp"

extern char** environ;

namespace {

constexpr std::string_view port_variable = "EFFECT_PLAYGROUND_CORE_PORT";
constexpr std::string_view log_prefix = "core: ";

// Every operation in protocol::Procedures, with its check and its work.
core::Operations operations() {
	core::Operations operations;
	operations.add<protocol::CustomCat>(custom_cat::check, custom_cat::copy);
	operations.add<protocol::CustomWc>(custom_wc::check, custom_wc::count);
	return operations;
}

[[noreturn]] void usage_error(const std::string& message) {
	std::cerr << log_prefix << message << "\nusage: core [-- COMMAND...]\n";
	std::exit(2);
}

std::vector<std::string> command_of(int argc, char** argv) {
	if (argc == 1) return {};
	if (std::string_view(argv[1]) != "--" || argc == 2) {
		usage_error("unknown argument " + std::string(argv[1]));
	}
	return {argv + 2, argv + argc};
}

std::uint16_t requested_port() {
	const char* value = std::getenv(std::string(port_variable).c_str());
	if (value == nullptr || *value == '\0') return 0;
	char* end = nullptr;
	const long port = std::strtol(value, &end, 10);
	if (*end != '\0' || port < 0 || port > 65535) {
		usage_error(std::string(port_variable) + " is not a port: " + value);
	}
	return static_cast<std::uint16_t>(port);
}

const int forwarded_signals[] = {SIGINT, SIGTERM, SIGHUP};

// Blocks the signals this process waits for, before any thread starts, so
// that they reach sigwait in main and nowhere else.
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
		std::cerr << log_prefix << "cannot start " << command[0] << ": "
				  << std::strerror(error) << "\n";
		std::exit(127);
	}
	return child;
}

int exit_code(int status) {
	if (WIFEXITED(status)) return WEXITSTATUS(status);
	if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
	return 1;
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

}  // namespace

int main(int argc, char** argv) {
	const std::vector<std::string> command = command_of(argc, argv);
	const sigset_t waited = block_waited_signals();
	// Forked before the server's thread and socket exist, so it holds neither.
	const std::optional<core::watchdog::Watchdog> guard =
		command.empty() ? std::nullopt : std::optional(core::watchdog::start());
	static const core::Operations served = operations();
	const auto listener =
		core::tcp_server::listen_on_loopback(requested_port());
	core::tcp_server::serve_in_background(listener, served);
	std::cerr << log_prefix << "serving over JSON-RPC on 127.0.0.1:"
			  << listener.port << std::endl;

	if (!guard) return supervise(waited, 0);
	const pid_t child = spawn(command, listener.port);
	core::watchdog::watch(*guard, child);
	const int code = supervise(waited, child);
	core::watchdog::stop(*guard);
	return code;
}
