#include "code_executor.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstdlib>
#include <algorithm>
#include <chrono>
#include <thread>

#ifdef _WIN32
#include <windows.h>
#endif

// ─────────────────────────────────────────────────────────────────────────────
std::string CodeExecutor::runCommand(const std::string& cmd) {
    std::string output;
    FILE* pipe = _popen(cmd.c_str(), "r");
    if (!pipe) return "[ERROR] Failed to run command: " + cmd;
    char buf[512];
    while (fgets(buf, sizeof(buf), pipe))
        output += buf;
    _pclose(pipe);
    return output;
}

// ─────────────────────────────────────────────────────────────────────────────
std::string CodeExecutor::writeTempFile(const std::string& code, const std::string& ext) {
    std::string tmp = std::getenv("TEMP") ? std::string(std::getenv("TEMP")) : ".";
    std::string path = tmp + "\\ww_code" + ext;
    std::ofstream f(path);
    f << code;
    return path;
}

void CodeExecutor::deleteTempFile(const std::string& path) {
    std::remove(path.c_str());
}

// ─────────────────────────────────────────────────────────────────────────────
std::string CodeExecutor::languageName(Language lang) {
    switch (lang) {
        case Language::CPP:        return "C++";
        case Language::C:          return "C";
        case Language::PYTHON:     return "Python";
        case Language::JAVASCRIPT: return "JavaScript";
        case Language::JAVA:       return "Java";
        case Language::RUST:       return "Rust";
        case Language::GO:         return "Go";
        case Language::TYPESCRIPT: return "TypeScript";
        case Language::BASH:       return "Bash";
        case Language::CSHARP:     return "C#";
        case Language::KOTLIN:     return "Kotlin";
        default:                   return "Unknown";
    }
}

std::string CodeExecutor::languageExtension(Language lang) {
    switch (lang) {
        case Language::CPP:        return ".cpp";
        case Language::C:          return ".c";
        case Language::PYTHON:     return ".py";
        case Language::JAVASCRIPT: return ".js";
        case Language::JAVA:       return ".java";
        case Language::RUST:       return ".rs";
        case Language::GO:         return ".go";
        case Language::TYPESCRIPT: return ".ts";
        case Language::BASH:       return ".sh";
        case Language::CSHARP:     return ".cs";
        case Language::KOTLIN:     return ".kt";
        default:                   return ".txt";
    }
}

// ─────────────────────────────────────────────────────────────────────────────
Language CodeExecutor::detectLanguage(const std::string& code, const std::string& hint) {
    std::string h = hint;
    std::transform(h.begin(), h.end(), h.begin(), ::tolower);

    if (h == "python" || h == "py")        return Language::PYTHON;
    if (h == "c++" || h == "cpp")          return Language::CPP;
    if (h == "c")                           return Language::C;
    if (h == "javascript" || h == "js")    return Language::JAVASCRIPT;
    if (h == "java")                        return Language::JAVA;
    if (h == "rust" || h == "rs")          return Language::RUST;
    if (h == "go" || h == "golang")        return Language::GO;
    if (h == "typescript" || h == "ts")    return Language::TYPESCRIPT;
    if (h == "bash" || h == "sh")          return Language::BASH;
    if (h == "c#" || h == "csharp")        return Language::CSHARP;

    // Auto-detect from code content
    if (code.find("#include") != std::string::npos) {
        if (code.find("std::") != std::string::npos ||
            code.find("cout")  != std::string::npos ||
            code.find("cin")   != std::string::npos)
            return Language::CPP;
        return Language::C;
    }
    if (code.find("def ") != std::string::npos ||
        code.find("import ") != std::string::npos ||
        code.find("print(") != std::string::npos)    return Language::PYTHON;
    if (code.find("public class") != std::string::npos) return Language::JAVA;
    if (code.find("fn main()") != std::string::npos)    return Language::RUST;
    if (code.find("func main()") != std::string::npos)  return Language::GO;
    if (code.find("console.log") != std::string::npos)  return Language::JAVASCRIPT;
    if (code.find("using System") != std::string::npos) return Language::CSHARP;

    return Language::PYTHON; // default fallback
}

// ─────────────────────────────────────────────────────────────────────────────
ExecutionResult CodeExecutor::execute(const std::string& code, const std::string& langHint) {
    Language lang = detectLanguage(code, langHint);
    return execute(code, lang);
}

// ─────────────────────────────────────────────────────────────────────────────
ExecutionResult CodeExecutor::execute(const std::string& code, Language lang) {
    ExecutionResult result;
    result.language = languageName(lang);

    std::string tmp = std::getenv("TEMP") ? std::string(std::getenv("TEMP")) : ".";
    std::string ext = languageExtension(lang);
    std::string srcFile = writeTempFile(code, ext);
    std::string outExe  = tmp + "\\ww_out.exe";

    std::string runCmd;

    switch (lang) {
        // ── Python ───────────────────────────────────────────────────────────
        case Language::PYTHON: {
            runCmd = "python \"" + srcFile + "\" 2>&1";
            break;
        }

        // ── C++ ──────────────────────────────────────────────────────────────
        case Language::CPP: {
            std::string compileOut = runCommand(
                "g++ -o \"" + outExe + "\" \"" + srcFile + "\" 2>&1"
            );
            if (!compileOut.empty() && compileOut.find("error") != std::string::npos) {
                result.errorOutput = compileOut;
                result.exitCode = 1;
                deleteTempFile(srcFile);
                return result;
            }
            runCmd = "\"" + outExe + "\" 2>&1";
            break;
        }

        // ── C ────────────────────────────────────────────────────────────────
        case Language::C: {
            std::string compileOut = runCommand(
                "gcc -o \"" + outExe + "\" \"" + srcFile + "\" 2>&1"
            );
            if (!compileOut.empty() && compileOut.find("error") != std::string::npos) {
                result.errorOutput = compileOut;
                result.exitCode = 1;
                deleteTempFile(srcFile);
                return result;
            }
            runCmd = "\"" + outExe + "\" 2>&1";
            break;
        }

        // ── JavaScript (Node.js) ─────────────────────────────────────────────
        case Language::JAVASCRIPT: {
            runCmd = "node \"" + srcFile + "\" 2>&1";
            break;
        }

        // ── TypeScript ───────────────────────────────────────────────────────
        case Language::TYPESCRIPT: {
            runCmd = "ts-node \"" + srcFile + "\" 2>&1";
            break;
        }

        // ── Java ─────────────────────────────────────────────────────────────
        case Language::JAVA: {
            std::string compileOut = runCommand("javac \"" + srcFile + "\" 2>&1");
            if (!compileOut.empty()) {
                result.errorOutput = compileOut;
                result.exitCode = 1;
                deleteTempFile(srcFile);
                return result;
            }
            // Extract class name from code
            std::string className = "Main";
            auto pos = code.find("public class ");
            if (pos != std::string::npos) {
                pos += 13;
                auto end = code.find_first_of(" {", pos);
                if (end != std::string::npos)
                    className = code.substr(pos, end - pos);
            }
            runCmd = "java -cp \"" + tmp + "\" " + className + " 2>&1";
            break;
        }

        // ── Rust ─────────────────────────────────────────────────────────────
        case Language::RUST: {
            std::string compileOut = runCommand(
                "rustc -o \"" + outExe + "\" \"" + srcFile + "\" 2>&1"
            );
            if (!compileOut.empty() && compileOut.find("error") != std::string::npos) {
                result.errorOutput = compileOut;
                result.exitCode = 1;
                deleteTempFile(srcFile);
                return result;
            }
            runCmd = "\"" + outExe + "\" 2>&1";
            break;
        }

        // ── Go ───────────────────────────────────────────────────────────────
        case Language::GO: {
            runCmd = "go run \"" + srcFile + "\" 2>&1";
            break;
        }

        // ── C# ───────────────────────────────────────────────────────────────
        case Language::CSHARP: {
            std::string compileOut = runCommand(
                "csc -out:\"" + outExe + "\" \"" + srcFile + "\" 2>&1"
            );
            if (!compileOut.empty() && compileOut.find("error") != std::string::npos) {
                result.errorOutput = compileOut;
                result.exitCode = 1;
                deleteTempFile(srcFile);
                return result;
            }
            runCmd = "\"" + outExe + "\" 2>&1";
            break;
        }

        // ── Bash ─────────────────────────────────────────────────────────────
        case Language::BASH: {
            runCmd = "bash \"" + srcFile + "\" 2>&1";
            break;
        }

        default: {
            result.errorOutput = "[whyWhale] Unsupported language.";
            result.exitCode = 1;
            deleteTempFile(srcFile);
            return result;
        }
    }

    // Run the command
    result.output = runCommand(runCmd);
    result.exitCode = 0;
    result.success  = result.errorOutput.empty();

    // Check if output contains error indicators
    if (result.output.find("Error") != std::string::npos ||
        result.output.find("error") != std::string::npos ||
        result.output.find("Exception") != std::string::npos ||
        result.output.find("Traceback") != std::string::npos) {
        result.errorOutput = result.output;
        result.success = false;
        result.exitCode = 1;
    } else {
        result.success = true;
    }

    // Cleanup
    deleteTempFile(srcFile);
    std::remove(outExe.c_str());

    return result;
}