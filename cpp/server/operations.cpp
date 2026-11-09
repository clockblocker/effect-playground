#include "server/operations.hpp"

namespace server {

const Handler* Operations::find(const std::string& method) const {
	const auto found = handlers_.find(method);
	return found == handlers_.end() ? nullptr : &found->second;
}

}  // namespace server
