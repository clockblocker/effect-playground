// core: the C++ core, which serves the operations, and launches the BFF
// that calls them.
//
//   core [-- COMMAND...]
//       Serves the operations over JSON-RPC on 127.0.0.1, on
//       $EFFECT_PLAYGROUND_CORE_PORT or an ephemeral port, in files/ under
//       its working directory. With a COMMAND, it spawns it with the port in
//       $EFFECT_PLAYGROUND_CORE_PORT, forwards SIGINT, SIGTERM and SIGHUP to
//       it, and exits with its status. If the core itself dies, a watchdog
//       stops the child (see server/watchdog.hpp). Without a COMMAND, it
//       serves until signalled.

#include <cstdlib>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "domain/operations/custom_cat.hpp"
#include "domain/operations/custom_wc.hpp"
#include "domain/protocol.hpp"
#include "server/launcher.hpp"
#include "server/operations.hpp"
#include "server/tcp_server.hpp"
#include "server/watchdog.hpp"

namespace {

using server::launcher::port_variable;
constexpr std::string_view log_prefix = "core: ";

// Every operation in protocol::Procedures, with its check and its work.
server::Operations operations() {
	server::Operations operations;
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

}  // namespace

int main(int argc, char** argv) {
	const std::vector<std::string> command = command_of(argc, argv);
	const sigset_t waited = server::launcher::block_waited_signals();
	// Forked before the server's thread and socket exist, so it holds neither.
	const std::optional<server::watchdog::Watchdog> guard =
		command.empty() ? std::nullopt : std::optional(server::watchdog::start());
	static const server::Operations served = operations();
	const auto listener =
		server::tcp_server::listen_on_loopback(requested_port());
	server::tcp_server::serve_in_background(listener, served);
	std::cerr << log_prefix << "serving over JSON-RPC on 127.0.0.1:"
			  << listener.port << std::endl;

	if (!guard) return server::launcher::supervise(waited, 0);
	const pid_t child = server::launcher::spawn(command, listener.port);
	server::watchdog::watch(*guard, child);
	const int code = server::launcher::supervise(waited, child);
	server::watchdog::stop(*guard);
	return code;
}
