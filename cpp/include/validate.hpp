#pragma once

#include <cstddef>
#include <rfl.hpp>
#include <string>
#include <string_view>
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

template <class Rule>
std::string limit() {
	if constexpr (requires { Rule::limit; }) {
		return std::to_string(Rule::limit);
	} else {
		return "{limit}";
	}
}

// `{value}` is the field's value, `{limit}` the rule's limit. An unknown
// placeholder stays as written; the generator rejects it first.
template <class Rule>
std::string fill(const std::string& value) {
	std::string message;
	std::string_view rest = Rule::message;
	while (true) {
		const auto open = rest.find('{');
		const auto close = rest.find('}', open);
		if (open == std::string_view::npos || close == std::string_view::npos) {
			return message + std::string(rest);
		}
		message += rest.substr(0, open);
		const auto placeholder = rest.substr(open, close - open + 1);
		if (placeholder == "{value}") {
			message += value;
		} else if (placeholder == "{limit}") {
			message += limit<Rule>();
		} else {
			message += placeholder;
		}
		rest = rest.substr(close + 1);
	}
}

template <class Rule>
Issue issue(const std::string& value, const std::vector<PathSegment>& path) {
	return Issue{.message = fill<Rule>(value), .path = path};
}

// Runs a Checked's rules, its base's first, and adds an issue per failed
// rule. Returns whether all of them passed.
template <class Base, class... Rules>
bool check(std::type_identity<Checked<Base, Rules...>>,
		   const std::string& value, const std::vector<PathSegment>& path,
		   std::vector<Issue>& issues) {
	if constexpr (checked::is_checked_v<Base>) {
		if (!check(std::type_identity<Base>(), value, path, issues)) {
			return false;
		}
	}
	bool passed = true;
	(
		[&] {
			if (Rules::passes(value)) return;
			issues.push_back(issue<Rules>(value, path));
			passed = false;
		}(),
		...);
	return passed;
}

// A struct's rules across its fields: `using Rules = std::tuple<…>`. A rule
// has a `name`, a `message`, `static bool passes(const Struct&)`, and in
// `field` a pointer to the member its issue goes on, whose value fills
// `{value}`.
template <class T>
concept HasRules = requires { typename T::Rules; };

template <class T>
const auto& raw_value(const T& field) {
	if constexpr (rfl::internal::is_description_v<T>) {
		return raw_value(field.get());
	} else {
		return field.value();
	}
}

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
			if (Rules::passes(value)) return true;
			const auto& member = value.*Rules::field;
			path.emplace_back(wire_name(value, &member));
			issues.push_back(issue<Rules>(raw_value(member), path));
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
			issues.push_back(issue<protocol::Present>("", path));
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

// Calls `visit.template operator()<Rule>()` for each rule a request's type
// can apply, Present included, with repeats.
template <class T, class Visit>
void for_each_rule(const Visit& visit);

template <class Base, class... Rules, class Visit>
void for_each_checked_rule(std::type_identity<Checked<Base, Rules...>>,
						   const Visit& visit) {
	if constexpr (checked::is_checked_v<Base>) for_each_rule<Base>(visit);
	(visit.template operator()<Rules>(), ...);
}

template <class... Rules, class Visit>
void for_each_struct_rule(std::type_identity<std::tuple<Rules...>>,
						  const Visit& visit) {
	(visit.template operator()<Rules>(), ...);
}

template <class T, class Visit>
void for_each_rule(const Visit& visit) {
	if constexpr (rfl::internal::is_description_v<T>) {
		for_each_rule<typename T::Type>(visit);
	} else if constexpr (checked::is_checked_v<T>) {
		visit.template operator()<protocol::Present>();
		for_each_checked_rule(std::type_identity<T>(), visit);
	} else if constexpr (is_vector<T>::value) {
		for_each_rule<typename T::value_type>(visit);
	} else if constexpr (std::is_class_v<T> && std::is_aggregate_v<T>) {
		using Fields = typename rfl::named_tuple_t<T>::Fields;
		[&]<std::size_t... index>(std::index_sequence<index...>) {
			(for_each_rule<std::remove_cvref_t<
				 typename rfl::tuple_element_t<index, Fields>::Type>>(visit),
			 ...);
		}(std::make_index_sequence<rfl::tuple_size_v<Fields>>());
		if constexpr (HasRules<T>) {
			for_each_struct_rule(std::type_identity<typename T::Rules>(), visit);
		}
	}
}

}  // namespace validate
