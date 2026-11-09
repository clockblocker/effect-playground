#pragma once

// The JSON-RPC 2.0 dialect of Effect's `RpcSerialization.layerNdJsonRpc()`,
// server side. One JSON value per line, each way. The bodies are in
// src/core/json_rpc.cpp.
//
// Requests: {"jsonrpc":"2.0","id":1,"method":"CustomCat","params":{...}}.
// Effect also sends "headers", "traceId", "spanId" and "sampled", which the
// core ignores.
//
// Responses carry the request's id unchanged:
// - success: {"jsonrpc":"2.0","id":1,"result":{...}}
// - failure: {"jsonrpc":"2.0","id":1,"error":{"_tag":"Cause","code":0,
//   "message":"...","data":<Cause>}}, where <Cause> is Effect's encoded Cause:
//   [{"_tag":"Fail","error":{"_tag":"IoFailed",...}}] for an operation's
//   failure and [{"_tag":"Die","defect":{"name":"Error","message":"..."}}]
//   for a defect. Without "_tag":"Cause", Effect would decode the whole error
//   object as the failure.
//
// Control messages have no id and a method under "@effect/rpc/":
// - Ping, sent every 5 s; answered with {"jsonrpc":"2.0",
//   "method":"@effect/rpc/Pong"}. A client that misses a pong drops the
//   connection.
// - Interrupt {"requestId":...}, Ack and Eof need no answer: each request is
//   answered before the next frame is read, so there is nothing to cancel.
//
// A frame that isn't JSON breaks the connection's protocol, so it gets the
// connection-wide {"error":{"_tag":"Defect",...}}, which fails every call the
// client has in flight.

#include <optional>
#include <rfl.hpp>
#include <string>
#include <string_view>

#include "protocol/wire.hpp"

namespace core {

class Operations;

namespace json_rpc {

// Handles one frame, without its newline, and returns the line to write
// back, or nothing for a notification or a control message that needs none.
std::optional<std::string> handle_frame(std::string_view frame,
										const Operations& operations);

// A response with `result`, already on the wire.
std::string result(const rfl::Generic& id, const rfl::Generic& value);

// A response with a Cause of one Fail of `error`, already on the wire.
std::string failure(const rfl::Generic& id, const std::string& message,
					const rfl::Generic& error);

// An operation's success, as a response.
template <class Success>
std::string succeed(const rfl::Generic& id, const Success& success) {
	return result(id, rfl::to_generic<protocol::Wire>(success));
}

// An operation's failure, tagged, as a response.
template <class Error>
std::string fail(const rfl::Generic& id, const Error& error) {
	return failure(
		id, protocol::message_of(error),
		rfl::to_generic<protocol::Wire>(rfl::TaggedUnion<"_tag", Error>(error)));
}

}  // namespace json_rpc
}  // namespace core
