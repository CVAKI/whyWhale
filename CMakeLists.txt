cmake_minimum_required(VERSION 3.20)
project(whyWhale CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# ── nlohmann/json ─────────────────────────────────────────────────────────────
FetchContent_Declare(
        nlohmann_json
        URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp
        DOWNLOAD_NO_EXTRACT TRUE
        SOURCE_DIR ${CMAKE_BINARY_DIR}/nlohmann_include/nlohmann
)
FetchContent_MakeAvailable(nlohmann_json)

# ── GLFW (window + OpenGL context) ───────────────────────────────────────────
set(GLFW_BUILD_DOCS     OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GLFW_INSTALL        OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
        glfw
        GIT_REPOSITORY https://github.com/glfw/glfw.git
        GIT_TAG        3.4
)
FetchContent_MakeAvailable(glfw)

# ── Dear ImGui (docking branch — required for panel layout) ──────────────────
FetchContent_Declare(
        imgui
        GIT_REPOSITORY https://github.com/ocornut/imgui.git
        GIT_TAG        docking
)
FetchContent_MakeAvailable(imgui)

find_package(OpenGL REQUIRED)

# ImGui has no CMakeLists — compile its sources manually as a static lib
add_library(imgui_impl STATIC
        ${imgui_SOURCE_DIR}/imgui.cpp
        ${imgui_SOURCE_DIR}/imgui_demo.cpp
        ${imgui_SOURCE_DIR}/imgui_draw.cpp
        ${imgui_SOURCE_DIR}/imgui_tables.cpp
        ${imgui_SOURCE_DIR}/imgui_widgets.cpp
        ${imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp
        ${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp
)
target_include_directories(imgui_impl PUBLIC
        ${imgui_SOURCE_DIR}
        ${imgui_SOURCE_DIR}/backends
)
target_link_libraries(imgui_impl PUBLIC glfw OpenGL::GL)

# ── Main executable ───────────────────────────────────────────────────────────
add_executable(whyWhale
        main.cpp
        src/ai_engine.cpp
        src/code_executor.cpp
        src/error_fixer.cpp
        src/editor_ui.cpp
        src/ollama_manager.cpp
)

target_include_directories(whyWhale PRIVATE
        ${CMAKE_SOURCE_DIR}
        ${CMAKE_SOURCE_DIR}/include
        ${CMAKE_BINARY_DIR}/nlohmann_include
        ${imgui_SOURCE_DIR}
        ${imgui_SOURCE_DIR}/backends
)

target_link_libraries(whyWhale PRIVATE
        imgui_impl
        glfw
        OpenGL::GL
)
# ── stb_image (single-header image loader) ───────────────────────────────────
FetchContent_Declare(
        stb
        GIT_REPOSITORY https://github.com/nothings/stb.git
        GIT_TAG        master
)
FetchContent_MakeAvailable(stb)

target_include_directories(whyWhale PRIVATE
        ${stb_SOURCE_DIR}
)

# ── Platform specifics ────────────────────────────────────────────────────────
if(WIN32)
    target_link_libraries(whyWhale PRIVATE ws2_32 shell32 opengl32)
    if(MSVC)
        target_compile_options(whyWhale PRIVATE /utf-8 /W3)
    else()
        target_compile_options(whyWhale PRIVATE -municode -Wall -Wextra)
    endif()
    # TRUE = hides the black console window on launch
    set_target_properties(whyWhale PROPERTIES WIN32_EXECUTABLE TRUE)
endif()

if(CMAKE_BUILD_TYPE STREQUAL "Release")
    if(MSVC)
        target_compile_options(whyWhale PRIVATE /O2)
    else()
        target_compile_options(whyWhale PRIVATE -O2)
    endif()
endif()

message(STATUS "whyWhale: ImGui + GLFW IDE build configured.")