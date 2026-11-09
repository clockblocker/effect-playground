#pragma once

// How the core launches its command, the BFF, and waits for it: the child
// gets the port the core serves on, the signals the core gets, and the
// core's exit is the child's. The bodies are in launcher.cpp.

#include <sys/types.h>

#include <csignal>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace server::launcher {

// Where the child finds the port: the core takes one from it, too, if set.
constexpr std::string_view port_variable = "EFFECT_PLAYGROUND_CORE_PORT";

// Blocks the signals the core waits for, SIGINT, SIGTERM, SIGHUP and
// SIGCHLD, so that they reach supervise() and nowhere else. Call it before
// any thread starts.
sigset_t block_waited_signals();

// Spawns `command` with the port in port_variable, its signals unblocked
// and at their defaults. Exits 127 if it can't.
pid_t spawn(const std::vector<std::string>& command, std::uint16_t port);

// Forwards SIGINT, SIGTERM and SIGHUP to `child`, and returns its exit
// status once it has exited, 128 + the signal if a signal killed it.
// Without a child, `child` 0, the first signal ends it, as 128 + the signal.
int supervise(const sigset_t& waited, pid_t child);

}  // namespace server::launcher
