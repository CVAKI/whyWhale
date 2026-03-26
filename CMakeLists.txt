cmake_minimum_required(VERSION 3.20)
project(whyWhale CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Auto-download nlohmann/json (header-only, no manual install needed) ──────
include(FetchContent)
FetchContent_Declare(
        nlohmann_json
        URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp
        DOWNLOAD_NO_EXTRACT TRUE
        SOURCE_DIR ${CMAKE_BINARY_DIR}/nlohmann
)
FetchContent_MakeAvailable(nlohmann_json)

# ── Sources ───────────────────────────────────────────────────────────────────
add_executable(whyWhale
        main.cpp
        ai_engine.cpp
        code_executor.cpp
        error_fixer.cpp
        editor_ui.cpp
        ollama_manager.cpp
)

# ── Include paths ─────────────────────────────────────────────────────────────
target_include_directories(whyWhale PRIVATE
        ${CMAKE_SOURCE_DIR}
        ${CMAKE_BINARY_DIR}/nlohmann
)

# ── Windows-specific settings ─────────────────────────────────────────────────
if(WIN32)
    # Link Winsock (needed by ollama_manager for TCP socket check)
    target_link_libraries(whyWhale PRIVATE ws2_32)

    # Use /utf-8 so MSVC handles Unicode string literals correctly
    if(MSVC)
        target_compile_options(whyWhale PRIVATE /utf-8 /W3)
    else()
        # MinGW / GCC on Windows
        target_compile_options(whyWhale PRIVATE -municode -Wall -Wextra)
    endif()

    # Set subsystem to CONSOLE (keeps the terminal window)
    set_target_properties(whyWhale PROPERTIES
            WIN32_EXECUTABLE FALSE
    )
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