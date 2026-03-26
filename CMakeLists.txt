cmake_minimum_required(VERSION 3.20)
project(whyWhale CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Auto-download nlohmann/json into a proper nlohmann/ subfolder ─────────────
include(FetchContent)
FetchContent_Declare(
        nlohmann_json
        URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp
        DOWNLOAD_NO_EXTRACT TRUE
        SOURCE_DIR ${CMAKE_BINARY_DIR}/nlohmann_include/nlohmann
)
FetchContent_MakeAvailable(nlohmann_json)

# ── Sources ───────────────────────────────────────────────────────────────────
add_executable(whyWhale
        main.cpp
        src/ai_engine.cpp
        src/code_executor.cpp
        src/error_fixer.cpp
        src/editor_ui.cpp
        src/ollama_manager.cpp
)

# ── Include paths ─────────────────────────────────────────────────────────────
target_include_directories(whyWhale PRIVATE
        ${CMAKE_SOURCE_DIR}
        ${CMAKE_SOURCE_DIR}/include
        ${CMAKE_BINARY_DIR}/nlohmann_include
)

# ── Windows-specific settings ─────────────────────────────────────────────────
if(WIN32)
    # ws2_32  = Winsock (TCP socket check)
    # shell32 = ShellExecuteEx (silent installer launch)
    target_link_libraries(whyWhale PRIVATE ws2_32 shell32)

    if(MSVC)
        target_compile_options(whyWhale PRIVATE /utf-8 /W3)
    else()
        target_compile_options(whyWhale PRIVATE -municode -Wall -Wextra)
    endif()

    set_target_properties(whyWhale PROPERTIES WIN32_EXECUTABLE FALSE)
endif()

# ── Release build optimisations ───────────────────────────────────────────────
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    if(MSVC)
        target_compile_options(whyWhale PRIVATE /O2)
    else()
        target_compile_options(whyWhale PRIVATE -O2)
    endif()
endif()

message(STATUS "whyWhale: CMake configured. Build with Ctrl+F9 in CLion.")