#pragma once

#include <rfl.hpp>
#include <string>
#include <string_view>
#include <type_traits>
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
	return Issue{
		.code = Rule::code, .message = fill<Rule>(value), .path = path};
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

// Walks a value of the request's own type: structs field by field, under
// their wire names, arrays element by element, under their indexes.
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
		protocol::Wire::process<T>(rfl::to_view(value)).apply(
			[&](const auto& field) {
				path.emplace_back(std::string(field.name()));
				walk(*field.value(), path, issues);
				path.pop_back();
			});
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
	}
}

}  // namespace validate
