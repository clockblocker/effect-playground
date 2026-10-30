#include "json_rpc.hpp"

#include <exception>
#include <variant>
#include <vector>

#include "error_message.hpp"
#include "read_file.hpp"
#include "reader_protocol.hpp"

namespace json_rpc {
namespace {

using namespace reader_protocol;

// The envelopes, as reflect-cpp structs: field order is wire order.

using Version = rfl::Literal<"2.0">;

template <rfl::internal::StringLiteral Name>
using Tag = rfl::Rename<"_tag", rfl::Literal<Name>>;

struct Incoming {
	std::optional<rfl::Generic> id;
	std::optional<std::string> method;
	std::optional<rfl::Generic> params;
};

template <class T>
struct ResultResponse {
	Version jsonrpc;
	rfl::Generic id;
	T result;
};

// An encoded Effect Error: Schema.Defect decodes it back into an Error.
struct Defect {
	std::string name = "Error";
	std::string message;
};

template <class E>
struct Fail {
	Tag<"Fail"> tag;
	E error;
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

std::string respond(const rfl::Generic& id, const reader::ReadFileOutcome& outcome) {
	if (const auto* success = std::get_if<ReadFileSuccess>(&outcome)) {
		return rfl::json::write(
			ResultResponse<ReadFileSuccess>{.id = id, .result = *success});
	}
	const auto& error = std::get<ReadFileError>(outcome);
	// Effect puts the error's own message here, as the client's getter would.
	const auto message = rfl::visit(
		[](const auto& alternative) { return error_message::fill(alternative); },
		error);
	return rfl::json::write(ErrorResponse<Fail<ReadFileError>>{
		.id = id,
		.error = {.message = message,
				  .data = {Fail<ReadFileError>{.error = error}}},
	});
}

std::optional<std::string> handle_message(const rfl::Generic& message,
										  const std::filesystem::path& files) {
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

	if (method != error_message::unqualified_name<ReadFile>()) {
		return answer(die(id, "Unknown method: " + method));
	}
	const auto request =
		rfl::from_generic<ReadFileRequest>(incoming->params.value_or(rfl::Generic()));
	if (!request) {
		return answer(die(id, "Invalid ReadFile params: " + request.error().what()));
	}
	try {
		return answer(respond(id, reader::read_file(files, *request)));
	} catch (const std::exception& defect) {
		return answer(die(id, defect.what()));
	}
}

}  // namespace

std::optional<std::string> handle_frame(std::string_view frame,
										const std::filesystem::path& files) {
	const auto parsed = rfl::json::read<rfl::Generic>(frame);
	if (!parsed) return protocol_defect("Unparseable frame: " + parsed.error().what());

	// A batch: answer every request in it, in one array.
	if (const auto batch = parsed->to_array()) {
		std::string responses;
		for (const auto& message : *batch) {
			const auto response = handle_message(message, files);
			if (!response) continue;
			responses += responses.empty() ? "[" : ",";
			responses += *response;
		}
		if (responses.empty()) return std::nullopt;
		return responses + "]";
	}
	return handle_message(*parsed, files);
}

}  // namespace json_rpc
