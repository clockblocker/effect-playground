#pragma once

#include <cstdint>
#include <filesystem>

namespace tcp_server {

struct Listener {
	int fd;
	std::uint16_t port;
};

// Binds 127.0.0.1:port; port 0 picks an ephemeral one. Throws
// std::system_error.
Listener listen_on_loopback(std::uint16_t port);

// Accepts connections on a background thread and serves each on its own,
// one newline-delimited JSON-RPC frame at a time.
void serve_in_background(Listener listener, std::filesystem::path files);

}  // namespace tcp_server
