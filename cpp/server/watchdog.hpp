#pragma once

#include <sys/types.h>

// Stops the core's child, the BFF, when the core dies by any means, SIGKILL and
// crashes included. macOS has no PR_SET_PDEATHSIG, and `bun --watch` outlives
// its script, so the child cannot be left to notice by itself.
//
// The watchdog is a forked process that holds the read end of a pipe whose
// write end only the core holds. The kernel closes that end however the
// core dies; the watchdog reads EOF, sends the child SIGTERM and, after a
// second, SIGKILL. When the core exits normally, it kills the watchdog
// first, so the watchdog never signals a pid that has been reaped and reused.
namespace server::watchdog {

struct Watchdog {
	pid_t pid;
	int fd;
};

// Forks the watchdog. Call it before any thread starts and before opening
// anything the watchdog must not hold, such as the listening socket. The
// watchdog inherits the core's blocked signals, so Ctrl-C and SIGTERM to
// the process group leave it alone.
Watchdog start();

// Tells the watchdog which pid to stop.
void watch(const Watchdog& watchdog, pid_t child);

// Kills and reaps the watchdog, for a core that is about to exit.
void stop(const Watchdog& watchdog);

}  // namespace server::watchdog
