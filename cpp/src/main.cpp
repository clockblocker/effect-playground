// effect-playground-cpp: the C++ file reader, and the launcher of the Bun
// server that calls it.
//
//   effect-playground-cpp --emit-schema
//       Prints the reader protocol's JSON Schema and exits.
//   effect-playground-cpp [--files DIR] [-- COMMAND...]
//       Serves the reader over JSON-RPC on 127.0.0.1, on
//       $EFFECT_PLAYGROUND_CPP_PORT or an ephemeral port, reading DIR
//       (default: ./files). With a COMMAND, it spawns it with the port in
//       $EFFECT_PLAYGROUND_CPP_PORT, forwards SIGINT, SIGTERM and SIGHUP to
//       it, and exits with its status. If the launcher itself dies, a
//       watchdog stops the child (see watchdog.hpp). Without a COMMAND, it
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

#include "protocol_schema.hpp"
#include "tcp_server.hpp"
#include "watchdog.hpp"

extern char** environ;

namespace {

constexpr std::string_view port_variable = "EFFECT_PLAYGROUND_CPP_PORT";
constexpr std::string_view log_prefix = "effect-playground-cpp: ";

struct Options {
	bool emit_schema = false;
	std::filesystem::path files = "files";
	std::vector<std::string> command;
};

[[noreturn]] void usage_error(const std::string& message) {
	std::cerr << log_prefix << message
			  << "\nusage: effect-playground-cpp --emit-schema\n"
				 "       effect-playground-cpp [--files DIR] [-- COMMAND...]\n";
	std::exit(2);
}

Options parse_options(int argc, char** argv) {
	Options options;
	for (int i = 1; i < argc; ++i) {
		const std::string_view arg = argv[i];
		if (arg == "--emit-schema") {
			options.emit_schema = true;
		} else if (arg == "--files") {
			if (++i == argc) usage_error("--files needs a directory");
			options.files = argv[i];
		} else if (arg == "--") {
			options.command.assign(argv + i + 1, argv + argc);
			break;
		} else {
			usage_error("unknown argument " + std::string(arg));
		}
	}
	return options;
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
	// A client that hangs up mid-write must not kill the reader.
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
	const Options options = parse_options(argc, argv);
	if (options.emit_schema) {
		std::cout << protocol_schema::emit() << "\n";
		return 0;
	}

	const sigset_t waited = block_waited_signals();
	// Forked before the reader's thread and socket exist, so it holds neither.
	const std::optional<watchdog::Watchdog> guard =
		options.command.empty() ? std::nullopt
								: std::optional(watchdog::start());
	const auto files = std::filesystem::absolute(options.files);
	const auto listener = tcp_server::listen_on_loopback(requested_port());
	tcp_server::serve_in_background(listener, files);
	std::cerr << log_prefix << "reading " << files.string()
			  << " over JSON-RPC on 127.0.0.1:" << listener.port << std::endl;

	if (!guard) return supervise(waited, 0);
	const pid_t child = spawn(options.command, listener.port);
	watchdog::watch(*guard, child);
	const int code = supervise(waited, child);
	watchdog::stop(*guard);
	return code;
}
