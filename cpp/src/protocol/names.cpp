#include "protocol/names.hpp"

namespace protocol {

std::optional<std::size_t> code_points(const std::string& value) {
	std::size_t count = 0;
	for (std::size_t i = 0; i < value.size(); ++count) {
		const auto lead = static_cast<unsigned char>(value[i]);
		const std::size_t length = lead < 0x80   ? 1
								   : lead < 0xC2 ? 0
								   : lead < 0xE0 ? 2
								   : lead < 0xF0 ? 3
								   : lead < 0xF5 ? 4
												 : 0;
		if (length == 0 || i + length > value.size()) return std::nullopt;
		for (std::size_t j = 1; j < length; ++j) {
			if ((static_cast<unsigned char>(value[i + j]) & 0xC0) != 0x80) {
				return std::nullopt;
			}
		}
		i += length;
	}
	return count;
}

}  // namespace protocol
