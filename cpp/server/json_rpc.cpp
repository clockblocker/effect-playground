#include "server/json_rpc.hpp"

#include <exception>

#include "server/operations.hpp"

namespace server::json_rpc {
namespace {

struct Incoming {
	std::optional<nlohmann::json> id;
	std::optional<std::string> method;
	std::optional<nlohmann::json> params;
};

constexpr std::string_view control_prefix = "@effect/rpc/";

// Replace invalid UTF-8 bytes rather than throwing, e.g. when echoing a
// nlohmann::json::parse_error message that quotes raw invalid bytes.
std::string dump_json(const nlohmann::json& value) {
	return value.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
}

std::string die(const nlohmann::json& id, const std::string& message) {
	return dump_json({
		{"jsonrpc", "2.0"},
		{"id", id},
		{"error",
		 {{"_tag", "Cause"},
		  {"code", 0},
		  {"message", message},
		  {"data",
		   nlohmann::json::array(
			   {{{"_tag", "Die"},
				 {"defect", {{"name", "Error"}, {"message", message}}}}})}}},
	});
}

std::string protocol_defect(const std::string& message) {
	return dump_json({
		{"jsonrpc", "2.0"},
		{"id", -32603},
		{"error",
		 {{"_tag", "Defect"},
		  {"code", 1},
		  {"message", "A defect occurred"},
		  {"data", {{"name", "Error"}, {"message", message}}}}},
	});
}

std::optional<std::string> handle_message(const nlohmann::json& message,
										  const Operations& operations) {
	const auto incoming = rfl::nlohmann::read<Incoming>(message);
	if (!incoming) return protocol_defect(incoming.error().what());
	// Without a method it's a response, which a server never expects.
	if (!incoming->method) return protocol_defect("Expected a request");
	const std::string& method = *incoming->method;

	if (method.starts_with(control_prefix)) {
		if (method == std::string(control_prefix) + "Ping") {
			return dump_json({
				{"jsonrpc", "2.0"},
				{"method", std::string(control_prefix) + "Pong"},
			});
		}
		return std::nullopt;
	}

	// A request without an id is a notification: run it, answer nothing.
	const nlohmann::json id = incoming->id.value_or(nlohmann::json());
	const auto answer = [&](std::string response) -> std::optional<std::string> {
		if (!incoming->id) return std::nullopt;
		return response;
	};

	const Handler* handler = operations.find(method);
	if (handler == nullptr) return answer(die(id, "Unknown method: " + method));
	try {
		return answer((*handler)(id, incoming->params.value_or(nlohmann::json())));
	} catch (const std::exception& defect) {
		return answer(die(id, defect.what()));
	}
}

}  // namespace

std::string result(const nlohmann::json& id, const nlohmann::json& value) {
	return dump_json({{"jsonrpc", "2.0"}, {"id", id}, {"result", value}});
}

std::string failure(const nlohmann::json& id, const std::string& message,
					const nlohmann::json& error) {
	return dump_json({
		{"jsonrpc", "2.0"},
		{"id", id},
		{"error",
		 {{"_tag", "Cause"},
		  {"code", 0},
		  {"message", message},
		  {"data",
		   nlohmann::json::array({{{"_tag", "Fail"}, {"error", error}}})}}},
	});
}

std::optional<std::string> handle_frame(std::string_view frame,
										const Operations& operations) {
	nlohmann::json parsed;
	try {
		parsed = nlohmann::json::parse(frame);
	} catch (const nlohmann::json::parse_error& error) {
		return protocol_defect("Unparseable frame: " +
							   std::string(error.what()));
	}

	// A batch: answer every request in it, in one array.
	if (parsed.is_array()) {
		std::string responses;
		for (const auto& message : parsed) {
			const auto response = handle_message(message, operations);
			if (!response) continue;
			responses += responses.empty() ? "[" : ",";
			responses += *response;
		}
		if (responses.empty()) return std::nullopt;
		return responses + "]";
	}
	return handle_message(parsed, operations);
}

}  // namespace server::json_rpc
