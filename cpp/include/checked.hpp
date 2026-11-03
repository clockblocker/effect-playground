#pragma once

#include <map>
#include <optional>
#include <rfl.hpp>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>

// A value of Base that carries Rules without enforcing them: reflect-cpp
// reads any value into it, and an absent one as missing, so that validate.hpp
// can report every rule that fails. Base is a raw type, or another Checked
// whose rules run first.
//
// A rule has a `code`, a `message` and `static bool passes(const Raw&)`. With
// `using Schema = …`, a reflect-cpp validator, and its `limit`, the JSON
// Schema carries the constraint too.
template <class Base, class... Rules>
class Checked;

namespace checked {

template <class T>
struct raw {
	using type = T;
};

template <class Base, class... Rules>
struct raw<Checked<Base, Rules...>> {
	using type = typename raw<Base>::type;
};

template <class T>
using raw_t = typename raw<T>::type;

template <class T>
struct is_checked : std::false_type {};

template <class Base, class... Rules>
struct is_checked<Checked<Base, Rules...>> : std::true_type {};

template <class T>
constexpr bool is_checked_v = is_checked<std::remove_cvref_t<T>>::value;

template <class Rule>
concept HasSchema = requires { typename Rule::Schema; };

// Every rule's Schema, the base's first, as a std::tuple.
template <class T>
struct schemas {
	using type = std::tuple<>;
};

template <class Rule>
struct schema_of {
	using type = std::tuple<>;
};

template <HasSchema Rule>
struct schema_of<Rule> {
	using type = std::tuple<typename Rule::Schema>;
};

template <class Base, class... Rules>
struct schemas<Checked<Base, Rules...>> {
	using type = decltype(std::tuple_cat(
		std::declval<typename schemas<Base>::type>(),
		std::declval<typename schema_of<Rules>::type>()...));
};

// What reflect-cpp describes a Checked as: its raw type, constrained by the
// rules that have a Schema.
template <class Raw, class Schemas>
struct described;

template <class Raw>
struct described<Raw, std::tuple<>> {
	using type = Raw;
};

template <class Raw, class... Schemas>
struct described<Raw, std::tuple<Schemas...>> {
	using type = rfl::Validator<Raw, Schemas...>;
};

template <class T>
using described_t =
	typename described<raw_t<T>, typename schemas<T>::type>::type;

}  // namespace checked

template <class Base, class... Rules>
class Checked {
   public:
	using Raw = checked::raw_t<Base>;

	Checked() = default;
	Checked(Raw value) : value_(std::move(value)) {}

	bool missing() const noexcept { return !value_.has_value(); }

	// Only for a value validate() accepted, which is never missing.
	const Raw& value() const { return value_.value(); }

   private:
	std::optional<Raw> value_;
};

namespace rfl::parsing {

template <class R, class W, class Base, class... Rules, class ProcessorsType>
	requires AreReaderAndWriter<R, W, Checked<Base, Rules...>>
struct Parser<R, W, Checked<Base, Rules...>, ProcessorsType> {
	using Type = Checked<Base, Rules...>;
	using Raw = typename Type::Raw;

	static Result<Type> read(const R& _r,
							 const typename R::InputVarType& _var) noexcept {
		return Parser<R, W, Raw, ProcessorsType>::read(_r, _var).transform(
			[](Raw&& _value) { return Type(std::move(_value)); });
	}

	template <class P>
	static void write(const W& _w, const Type& _checked, const P& _parent) {
		Parser<R, W, Raw, ProcessorsType>::write(_w, _checked.value(),
												 _parent);
	}

	static schema::Type to_schema(
		std::map<std::string, schema::Type>* _definitions) {
		return Parser<R, W, checked::described_t<Type>,
					  ProcessorsType>::to_schema(_definitions);
	}
};

}  // namespace rfl::parsing
