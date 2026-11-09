cmake_minimum_required(VERSION 3.24)
project(effect_playground LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(NOT CMAKE_BUILD_TYPE)
	set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)

# JSON only, with the yyjson that ships inside reflect-cpp: no vcpkg, no conan.
set(REFLECTCPP_JSON ON CACHE BOOL "" FORCE)
set(REFLECTCPP_USE_BUNDLED_DEPENDENCIES ON CACHE BOOL "" FORCE)
set(REFLECTCPP_USE_VCPKG OFF CACHE BOOL "" FORCE)
set(REFLECTCPP_BUILD_TESTS OFF CACHE BOOL "" FORCE)
# main at e91ea28, after v0.27.1: the first with rfl::Error::details() (#766).
FetchContent_Declare(
	reflectcpp
	URL https://github.com/munich-data-engineering/reflect-cpp/archive/e91ea28f0dd49058109e80a03cdf593cd4977856.tar.gz
	URL_HASH SHA256=0f5dd79386aea5e078c56eb142dd9d50723b11bd0fa63e12338900e22a8f2339
)
FetchContent_MakeAvailable(reflectcpp)

add_executable(custom_cat src/custom_cat.cpp)
add_executable(protocol_schema src/protocol_schema.cpp)

foreach(target custom_cat protocol_schema)
	target_include_directories(${target} PRIVATE include)
	target_link_libraries(${target} PRIVATE reflectcpp)
	target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic)
endforeach()
