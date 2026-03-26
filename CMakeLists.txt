cmake_minimum_required(VERSION 3.20)
project(whyWhale)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Auto-fetch nlohmann/json (no manual install needed) ──────────────────────
include(FetchContent)
FetchContent_Declare(
        json
        URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(json)

# ── Include dirs ─────────────────────────────────────────────────────────────
include_directories(include)

# ── Source files ─────────────────────────────────────────────────────────────
set(SOURCES
        src/ollama_manager.cpp
        src/ai_engine.cpp
        src/code_executor.cpp
        src/error_fixer.cpp
        src/editor_ui.cpp
)

add_executable(whyWhale main.cpp ${SOURCES})

# ── Link libraries ────────────────────────────────────────────────────────────
target_link_libraries(whyWhale
        PRIVATE
        nlohmann_json::nlohmann_json
        ws2_32
)