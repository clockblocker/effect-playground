#pragma once

// The operations the core serves, each under its procedure's name, such as
// "CustomCat", and how it runs one for a JSON-RPC request, in its steps:
//
// 1. read: reflect-cpp reads the Request from the request's params, with the
//    rules its fields' types carry, and reports every field that breaks one;
// 2. check: the operation's check, a Request → rfl::Result<Request>, asks
//    what the types can't, such as the files, once every field passes;
// 3. act: the operation's work, which may throw files::IoFailure;
// 4. answer: the success as the result, or the InvalidRequest of what 1 or 2
//    found, or the IoFailed of 3, as the failure. Anything else it throws is
//    a defect, which json_rpc answers.

#include <functional>
#include <map>
#include <rfl.hpp>
#include <string>
#include <utility>

#include "server/json_rpc.hpp"
#include "domain/files.hpp"
#include "domain/protocol/wire.hpp"

namespace server {

// What answers a request: its id and params → the response line.
using Handler =
	std::function<std::string(const rfl::Generic& id, const rfl::Generic& params)>;

class Operations {
   public:
	// Serves Procedure, such as protocol::CustomCat, with its check and its
	// work.
	template <class Procedure>
	void add(auto check, auto act);

	// The handler of the operation named `method`, or nothing.
	const Handler* find(const std::string& method) const;

   private:
	std::map<std::string, Handler> handlers_;
};

// A procedure's name, without its namespace: protocol::CustomCat → CustomCat,
// as the generator names its TS namespace and RPC.
template <class Procedure>
std::string name_of() {
	const std::string name = rfl::type_name_t<Procedure>().str();
	const auto separator = name.rfind("::");
	return separator == std::string::npos ? name : name.substr(separator + 2);
}

template <class Procedure>
void Operations::add(auto check, auto act) {
	using Request = decltype(Procedure::payload);
	handlers_[name_of<Procedure>()] = [check, act](const rfl::Generic& id,
												   const rfl::Generic& params) {
		auto request =
			rfl::from_generic<Request, protocol::Wire, rfl::NoExtraFields>(params)
				.and_then(check);
		if (!request) {
			return json_rpc::fail(
				id, protocol::InvalidRequest{
						.issues = protocol::issues(std::move(request).error())});
		}
		try {
			return json_rpc::succeed(id, act(*request));
		} catch (const files::IoFailure& failure) {
			return json_rpc::fail(id, failure.failed);
		}
	};
}

}  // namespace server
