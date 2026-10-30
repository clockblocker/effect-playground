#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

// The JSON-RPC 2.0 dialect of Effect's `RpcSerialization.layerNdJsonRpc()`,
// server side. One JSON value per line, each way.
//
// Requests: {"jsonrpc":"2.0","id":1,"method":"ReadFile","params":{...}}.
// Effect also sends "headers", "traceId", "spanId" and "sampled", which this
// server ignores.
//
// Responses carry the request's id unchanged:
// - success: {"jsonrpc":"2.0","id":1,"result":{...}}
// - failure: {"jsonrpc":"2.0","id":1,"error":{"_tag":"Cause","code":0,
//   "message":"...","data":<Cause>}}, where <Cause> is Effect's encoded Cause:
//   [{"_tag":"Fail","error":{"_tag":"NotTxtFile",...}}] for a typed error and
//   [{"_tag":"Die","defect":{"name":"Error","message":"..."}}] for a defect.
//   Without "_tag":"Cause", Effect would decode the whole error object as the
//   failure value.
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
namespace json_rpc {

// Handles one frame (without its newline) and returns the line to write
// back, or nothing for notifications and control messages that need none.
std::optional<std::string> handle_frame(
	std::string_view frame, const std::filesystem::path& files_directory);

}  // namespace json_rpc
