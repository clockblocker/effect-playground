#pragma once

#include <map>
#include <rfl.hpp>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>

// A value of Base that carries reflect-cpp validators without enforcing them:
// reflect-cpp reads any value into it, and an absent one as missing, so that
// validate.hpp can report every validator that fails. Base is a raw type, or
// another Checked whose validators run first. A validator with a `to_schema`,
// such as rfl::Size or rfl::PatternValidator, is in the JSON Schema too.
template <class Base, class... Validators>
class Checked;

namespace checked {

template <class T>
struct raw {
	using type = T;
};

template <class Base, class... Validators>
struct raw<Checked<Base, Validators...>> {
	using type = typename raw<Base>::type;
};

template <class T>
using raw_t = typename raw<T>::type;

template <class T>
struct is_checked : std::false_type {};

template <class Base, class... Validators>
struct is_checked<Checked<Base, Validators...>> : std::true_type {};

template <class T>
constexpr bool is_checked_v = is_checked<std::remove_cvref_t<T>>::value;

template <class Validator, class Raw>
concept HasSchema = requires { Validator::template to_schema<Raw>(); };

// Every validator with a schema, the base's first, as a std::tuple.
template <class T>
struct schemas {
	using type = std::tuple<>;
};

template <class Validator, class Raw>
struct schema_of {
	using type = std::tuple<>;
};

template <class Validator, class Raw>
	requires HasSchema<Validator, Raw>
struct schema_of<Validator, Raw> {
	using type = std::tuple<Validator>;
};

template <class Base, class... Validators>
struct schemas<Checked<Base, Validators...>> {
	using type = decltype(std::tuple_cat(
		std::declval<typename schemas<Base>::type>(),
		std::declval<typename schema_of<Validators, raw_t<Base>>::type>()...));
};

// What reflect-cpp describes a Checked as: its raw type, constrained by the
// validators that have a schema.
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

template <class Base, class... Validators>
class Checked {
   public:
	using Raw = checked::raw_t<Base>;

	Checked() = default;
	Checked(Raw value) : value_(std::move(value)) {}

	const Raw& value() const noexcept { return value_; }

   private:
	Raw value_{};
};

namespace rfl::parsing {

template <class R, class W, class Base, class... Validators,
		  class ProcessorsType>
	requires AreReaderAndWriter<R, W, Checked<Base, Validators...>>
struct Parser<R, W, Checked<Base, Validators...>, ProcessorsType> {
	using Type = Checked<Base, Validators...>;
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
