#pragma once

// Where the core listens for the BFF: 127.0.0.1, one newline-delimited
// JSON-RPC frame at a time per connection. The bodies are in
// src/core/tcp_server.cpp.

#include <cstdint>

namespace core {

class Operations;

namespace tcp_server {

struct Listener {
	int fd;
	std::uint16_t port;
};

// Binds 127.0.0.1:port; port 0 picks an ephemeral one. Throws
// std::system_error.
Listener listen_on_loopback(std::uint16_t port);

// Accepts connections on a background thread and serves each on its own.
// `operations` must outlive the process's last connection.
void serve_in_background(Listener listener, const Operations& operations);

}  // namespace tcp_server
}  // namespace core
