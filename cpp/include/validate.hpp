#pragma once

#include <cstddef>
#include <rfl.hpp>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

#include "checked.hpp"
#include "protocol.hpp"

namespace validate {

using protocol::Issue;
using protocol::PathSegment;

template <class T>
struct is_vector : std::false_type {};

template <class T>
struct is_vector<std::vector<T>> : std::true_type {};

// Runs a Checked's validators, its base's first, and adds an issue per
// failed validator, its message the validator's own. Returns whether all of
// them passed.
template <class Base, class... Validators>
bool check(std::type_identity<Checked<Base, Validators...>>,
		   const checked::raw_t<Base>& value,
		   const std::vector<PathSegment>& path, std::vector<Issue>& issues) {
	if constexpr (checked::is_checked_v<Base>) {
		if (!check(std::type_identity<Base>(), value, path, issues)) {
			return false;
		}
	}
	bool passed = true;
	(
		[&] {
			const auto result = Validators::validate(value);
			if (result) return;
			issues.push_back(Issue{.message = result.error().what(), .path = path});
			passed = false;
		}(),
		...);
	return passed;
}

// A struct's rules across its fields: `using Rules = std::tuple<…>`. A rule
// is a reflect-cpp validator of the struct, `static rfl::Result<T>
// validate(const T&)`, and in `field` a pointer to the member its issue goes
// on.
template <class T>
concept HasRules = requires { typename T::Rules; };

// The wire name of the member `member` points into `value`.
template <class T>
std::string wire_name(const T& value, const void* member) {
	std::string name;
	protocol::Wire::process<T>(rfl::to_view(value)).apply(
		[&](const auto& field) {
			if (static_cast<const void*>(field.value()) == member) {
				name = std::string(field.name());
			}
		});
	return name;
}

// Runs a struct's rules in order and stops at the first that fails, as a
// Checked's base stops its refinements: a rule may assume the ones before it
// passed.
template <class T, class... Rules>
void check_rules(std::type_identity<std::tuple<Rules...>>, const T& value,
				 std::vector<PathSegment>& path, std::vector<Issue>& issues) {
	(
		[&] {
			const auto result = Rules::validate(value);
			if (result) return true;
			path.emplace_back(wire_name(value, &(value.*Rules::field)));
			issues.push_back(Issue{.message = result.error().what(), .path = path});
			path.pop_back();
			return false;
		}() &&
		...);
}

// Walks a value of the request's own type: structs field by field, under
// their wire names, arrays element by element, under their indexes. A
// struct's own rules run once its fields pass theirs.
template <class T>
void walk(const T& value, std::vector<PathSegment>& path,
		  std::vector<Issue>& issues) {
	if constexpr (rfl::internal::is_description_v<T>) {
		walk(value.get(), path, issues);
	} else if constexpr (checked::is_checked_v<T>) {
		if (value.missing()) {
			issues.push_back(Issue{.message = "Required", .path = path});
		} else {
			check(std::type_identity<T>(), value.value(), path, issues);
		}
	} else if constexpr (is_vector<T>::value) {
		for (std::size_t index = 0; index < value.size(); ++index) {
			path.emplace_back(static_cast<int>(index));
			walk(value[index], path, issues);
			path.pop_back();
		}
	} else if constexpr (std::is_class_v<T> && std::is_aggregate_v<T>) {
		const auto before = issues.size();
		protocol::Wire::process<T>(rfl::to_view(value)).apply(
			[&](const auto& field) {
				path.emplace_back(std::string(field.name()));
				walk(*field.value(), path, issues);
				path.pop_back();
			});
		if constexpr (HasRules<T>) {
			if (issues.size() == before) {
				check_rules(std::type_identity<typename T::Rules>(), value, path,
							issues);
			}
		}
	}
}

// Every issue with a request, in field order; none if it is valid.
template <class Request>
std::vector<Issue> validate(const Request& request) {
	std::vector<PathSegment> path;
	std::vector<Issue> issues;
	walk(request, path, issues);
	return issues;
}

}  // namespace validate
