#include "core/operation.hpp"

namespace core {

const Handler* Operations::find(const std::string& method) const {
	const auto found = handlers_.find(method);
	return found == handlers_.end() ? nullptr : &found->second;
}

}  // namespace core
