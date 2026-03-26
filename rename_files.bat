@echo off
cd /d "%~dp0"

echo [whyWhale] Renaming source files...

for %%f in (*_ai_engine.cpp)     do ren "%%f" ai_engine.cpp
for %%f in (*_ai_engine.h)       do ren "%%f" ai_engine.h
for %%f in (*_code_executor.cpp) do ren "%%f" code_executor.cpp
for %%f in (*_code_executor.h)   do ren "%%f" code_executor.h
for %%f in (*_editor_ui.cpp)     do ren "%%f" editor_ui.cpp
for %%f in (*_editor_ui.h)       do ren "%%f" editor_ui.h
for %%f in (*_error_fixer.cpp)   do ren "%%f" error_fixer.cpp
for %%f in (*_error_fixer.h)     do ren "%%f" error_fixer.h
for %%f in (*_ollama_manager.cpp) do ren "%%f" ollama_manager.cpp
for %%f in (*_ollama_manager.h)  do ren "%%f" ollama_manager.h
for %%f in (*_main.cpp)          do ren "%%f" main.cpp
for %%f in (*_CMakeLists.txt)    do ren "%%f" CMakeLists.txt

echo [whyWhale] Done! Files renamed:
dir /b *.cpp *.h *.txt 2>nul

echo.
echo Now reload CMake in CLion and press Ctrl+F9 to build.
pause
