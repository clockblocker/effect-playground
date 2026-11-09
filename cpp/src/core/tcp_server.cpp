#include "core/tcp_server.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <string>
#include <string_view>
#include <system_error>
#include <functional>
#include <thread>

#include "core/json_rpc.hpp"

namespace core::tcp_server {
namespace {

[[noreturn]] void throw_errno(const char* what) {
	throw std::system_error(errno, std::generic_category(), what);
}

// The core launches the BFF, which must not inherit these sockets.
void close_on_exec(int fd) { fcntl(fd, F_SETFD, FD_CLOEXEC); }

bool write_all(int fd, std::string_view data) {
	while (!data.empty()) {
		const auto written = ::write(fd, data.data(), data.size());
		if (written < 0 && errno == EINTR) continue;
		if (written <= 0) return false;
		data.remove_prefix(static_cast<std::size_t>(written));
	}
	return true;
}

void serve_connection(int fd, const Operations& operations) {
	std::string buffer;
	char chunk[64 * 1024];
	while (true) {
		const auto received = ::read(fd, chunk, sizeof chunk);
		if (received < 0 && errno == EINTR) continue;
		if (received <= 0) break;
		buffer.append(chunk, static_cast<std::size_t>(received));

		std::size_t start = 0;
		for (auto end = buffer.find('\n'); end != std::string::npos;
			 end = buffer.find('\n', start)) {
			const std::string_view frame(buffer.data() + start, end - start);
			start = end + 1;
			if (frame.find_first_not_of(" \t\r") == std::string_view::npos) {
				continue;
			}
			if (const auto response = json_rpc::handle_frame(frame, operations)) {
				if (!write_all(fd, *response + "\n")) {
					::close(fd);
					return;
				}
			}
		}
		buffer.erase(0, start);
	}
	::close(fd);
}

}  // namespace

Listener listen_on_loopback(std::uint16_t port) {
	const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
	if (fd < 0) throw_errno("socket");
	close_on_exec(fd);
	const int on = 1;
	::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on);

	sockaddr_in address{};
	address.sin_family = AF_INET;
	address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	address.sin_port = htons(port);
	if (::bind(fd, reinterpret_cast<sockaddr*>(&address), sizeof address) < 0) {
		throw_errno("bind");
	}
	if (::listen(fd, SOMAXCONN) < 0) throw_errno("listen");

	socklen_t length = sizeof address;
	if (::getsockname(fd, reinterpret_cast<sockaddr*>(&address), &length) < 0) {
		throw_errno("getsockname");
	}
	return {.fd = fd, .port = ntohs(address.sin_port)};
}

void serve_in_background(Listener listener, const Operations& operations) {
	std::thread([listener, &operations] {
		while (true) {
			const int connection = ::accept(listener.fd, nullptr, nullptr);
			if (connection < 0) {
				if (errno == EINTR || errno == ECONNABORTED) continue;
				return;
			}
			close_on_exec(connection);
			std::thread(serve_connection, connection, std::cref(operations)).detach();
		}
	}).detach();
}

}  // namespace core::tcp_server
