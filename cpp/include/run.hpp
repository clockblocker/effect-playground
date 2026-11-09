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
#include "protocol/common.hpp"

namespace protocol {

// No rules across a request's fields.
struct NoRules {
	template <class T>
	static rfl::Result<T> validate(T value) noexcept {
		return value;
	}
};

// Reads a Request, checks its Rules once its fields pass theirs, and prints
// the Output of `action`, which may throw files::IoFailure.
template <class Output, class Request, class Rules = NoRules>
int run(int argc, char* argv[], const auto& action) {
	const auto print = [](const Output& output) {
		std::cout << rfl::json::write<Wire>(output) << "\n";
	};
	try {
		auto request =
			rfl::cli::read<Request, rfl::NoExtraFields>(argc, argv)
				.and_then(Rules::template validate<Request>);
		if (!request) {
			print(Output(
				InvalidRequest{.issues = issues(std::move(request).error())}));
			return 1;
		}
		print(Output(action(*request)));
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
