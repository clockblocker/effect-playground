#pragma once

#include <sys/types.h>

// Stops the launcher's child when the launcher dies by any means, SIGKILL and
// crashes included. macOS has no PR_SET_PDEATHSIG, and `bun --watch` outlives
// its script, so the child cannot be left to notice by itself.
//
// The watchdog is a forked process that holds the read end of a pipe whose
// write end only the launcher holds. The kernel closes that end however the
// launcher dies; the watchdog reads EOF, sends the child SIGTERM and, after a
// second, SIGKILL. When the launcher exits normally, it kills the watchdog
// first, so the watchdog never signals a pid that has been reaped and reused.
namespace watchdog {

struct Watchdog {
	pid_t pid;
	int fd;
};

// Forks the watchdog. Call it before any thread starts and before opening
// anything the watchdog must not hold, such as the listening socket. The
// watchdog inherits the launcher's blocked signals, so Ctrl-C and SIGTERM to
// the process group leave it alone.
Watchdog start();

// Tells the watchdog which pid to stop.
void watch(const Watchdog& watchdog, pid_t child);

// Kills and reaps the watchdog, for a launcher that is about to exit.
void stop(const Watchdog& watchdog);

}  // namespace watchdog
