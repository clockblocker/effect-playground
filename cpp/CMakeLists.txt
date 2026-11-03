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
FetchContent_Declare(
	reflectcpp
	GIT_REPOSITORY https://github.com/getml/reflect-cpp.git
	GIT_TAG v0.26.2
	GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(reflectcpp)

add_executable(custom_cat src/custom_cat.cpp)
add_executable(protocol_schema src/protocol_schema.cpp)

foreach(target custom_cat protocol_schema)
	target_include_directories(${target} PRIVATE include)
	target_link_libraries(${target} PRIVATE reflectcpp)
	target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic)
endforeach()
