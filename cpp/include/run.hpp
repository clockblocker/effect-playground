#pragma once

// An operation's executable: run() reads its request from the flags, which
// reflect-cpp spells in kebab-case, and prints its output. The exit codes,
// the same for every operation:
//
// - 0: stdout is the success.
// - 1: stdout is the InvalidRequest, every issue with the flags.
// - 3: a file couldn't be read or written; stdout is the IoFailed.
// - 4: anything else, which would be a bug, on stderr.

#include <exception>
#include <filesystem>
#include <iostream>
#include <rfl/cli.hpp>
#include <rfl/json.hpp>
#include <utility>

#include "files.hpp"
#include "protocol/wire.hpp"

namespace protocol {

// Runs an operation, in its steps:
//
// 1. read: reflect-cpp reads a Request from the flags, with the rules its
//    fields' types carry, and reports every field that breaks one;
// 2. check: `check`, a Request → rfl::Result<Request>, asks what the types
//    can't, such as the files, once every field passes its own rules;
// 3. act: `act`, a Request → its success, does the work, and may throw
//    files::IoFailure;
// 4. print: the success, the InvalidRequest of what 1 or 2 found, or the
//    IoFailed of 3, as the Output.
template <class Output, class Request>
int run(int argc, char* argv[], const auto& check, const auto& act) {
	const auto print = [](const Output& output) {
		std::cout << rfl::json::write<Wire>(output) << "\n";
	};
	try {
		auto request =
			rfl::cli::read<Request, rfl::NoExtraFields>(argc, argv).and_then(
				check);
		if (!request) {
			print(Output(
				InvalidRequest{.issues = issues(std::move(request).error())}));
			return 1;
		}
		print(Output(act(*request)));
		return 0;
	} catch (const files::IoFailure& failure) {
		print(Output(failure.failed));
		return 3;
	} catch (const std::exception& unexpected) {
		std::cerr << std::filesystem::path(argv[0]).filename().string() << ": "
				  << unexpected.what() << "\n";
		return 4;
	}
}

}  // namespace protocol
