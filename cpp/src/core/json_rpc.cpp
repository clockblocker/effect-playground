#include "core/json_rpc.hpp"

#include <exception>
#include <rfl/json.hpp>
#include <vector>

#include "core/operation.hpp"

namespace core::json_rpc {
namespace {

// The envelopes, as reflect-cpp structs: field order is wire order.

using Version = rfl::Literal<"2.0">;

template <rfl::internal::StringLiteral Name>
using Tag = rfl::Rename<"_tag", rfl::Literal<Name>>;

struct Incoming {
	std::optional<rfl::Generic> id;
	std::optional<std::string> method;
	std::optional<rfl::Generic> params;
};

struct ResultResponse {
	Version jsonrpc;
	rfl::Generic id;
	rfl::Generic result;
};

// An encoded Effect Error: Schema.Defect decodes it back into an Error.
struct Defect {
	std::string name = "Error";
	std::string message;
};

struct Fail {
	Tag<"Fail"> tag;
	rfl::Generic error;
};

struct Die {
	Tag<"Die"> tag;
	Defect defect;
};

template <class Reason>
struct CauseError {
	Tag<"Cause"> tag;
	int code = 0;
	std::string message;
	std::vector<Reason> data;
};

template <class Reason>
struct ErrorResponse {
	Version jsonrpc;
	rfl::Generic id;
	CauseError<Reason> error;
};

struct ProtocolDefect {
	Tag<"Defect"> tag;
	int code = 1;
	std::string message = "A defect occurred";
	Defect data;
};

// Effect fills the id of a Defect with JSON-RPC's "internal error" code.
struct ProtocolDefectResponse {
	Version jsonrpc;
	int id = -32603;
	ProtocolDefect error;
};

struct Control {
	Version jsonrpc;
	std::string method;
};

constexpr std::string_view control_prefix = "@effect/rpc/";

std::string die(const rfl::Generic& id, const std::string& message) {
	return rfl::json::write(ErrorResponse<Die>{
		.id = id,
		.error = {.message = message,
				  .data = {Die{.defect = {.message = message}}}},
	});
}

std::string protocol_defect(const std::string& message) {
	return rfl::json::write(
		ProtocolDefectResponse{.error = {.data = {.message = message}}});
}

std::optional<std::string> handle_message(const rfl::Generic& message,
										  const Operations& operations) {
	const auto incoming = rfl::from_generic<Incoming>(message);
	if (!incoming) return protocol_defect(incoming.error().what());
	// Without a method it's a response, which a server never expects.
	if (!incoming->method) return protocol_defect("Expected a request");
	const std::string& method = *incoming->method;

	if (method.starts_with(control_prefix)) {
		if (method == std::string(control_prefix) + "Ping") {
			return rfl::json::write(
				Control{.method = std::string(control_prefix) + "Pong"});
		}
		return std::nullopt;
	}

	// A request without an id is a notification: run it, answer nothing.
	const rfl::Generic id = incoming->id.value_or(rfl::Generic());
	const auto answer = [&](std::string response) -> std::optional<std::string> {
		if (!incoming->id) return std::nullopt;
		return response;
	};

	const Handler* handler = operations.find(method);
	if (handler == nullptr) return answer(die(id, "Unknown method: " + method));
	try {
		return answer((*handler)(id, incoming->params.value_or(rfl::Generic())));
	} catch (const std::exception& defect) {
		return answer(die(id, defect.what()));
	}
}

}  // namespace

std::string result(const rfl::Generic& id, const rfl::Generic& value) {
	return rfl::json::write(ResultResponse{.id = id, .result = value});
}

std::string failure(const rfl::Generic& id, const std::string& message,
					const rfl::Generic& error) {
	return rfl::json::write(ErrorResponse<Fail>{
		.id = id,
		.error = {.message = message, .data = {Fail{.error = error}}},
	});
}

std::optional<std::string> handle_frame(std::string_view frame,
										const Operations& operations) {
	const auto parsed = rfl::json::read<rfl::Generic>(frame);
	if (!parsed) {
		return protocol_defect("Unparseable frame: " + parsed.error().what());
	}

	// A batch: answer every request in it, in one array.
	if (const auto batch = parsed->to_array()) {
		std::string responses;
		for (const auto& message : *batch) {
			const auto response = handle_message(message, operations);
			if (!response) continue;
			responses += responses.empty() ? "[" : ",";
			responses += *response;
		}
		if (responses.empty()) return std::nullopt;
		return responses + "]";
	}
	return handle_message(*parsed, operations);
}

}  // namespace core::json_rpc
