#include "code_executor.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstdlib>
#include <algorithm>
#include <cstring>

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

// ─────────────────────────────────────────────────────────────────────────────
// Cross-platform popen/pclose
// ─────────────────────────────────────────────────────────────────────────────
std::string CodeExecutor::runCommand(const std::string& cmd) {
    std::string output;
#ifdef _WIN32
    FILE* pipe = _popen(cmd.c_str(), "r");
#else
    FILE* pipe = popen(cmd.c_str(), "r");
#endif
    if (!pipe) return "[ERROR] Failed to run: " + cmd;
    char buf[512];
    while (fgets(buf, sizeof(buf), pipe))
        output += buf;
#ifdef _WIN32
    _pclose(pipe);
#else
    pclose(pipe);
#endif
    return output;
}

// ─────────────────────────────────────────────────────────────────────────────
static std::string tempDir() {
#ifdef _WIN32
    const char* t = std::getenv("TEMP");
    if (!t) t = std::getenv("TMP");
    return t ? std::string(t) : "C:\\Temp";
#else
    return "/tmp";
#endif
}

static std::string pathSep() {
#ifdef _WIN32
    return "\\";
#else
    return "/";
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
std::string CodeExecutor::writeTempFile(const std::string& code, const std::string& ext) {
    std::string path = tempDir() + pathSep() + "ww_code" + ext;
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

    if (h == "python" || h == "py")         return Language::PYTHON;
    if (h == "c++" || h == "cpp")           return Language::CPP;
    if (h == "c")                            return Language::C;
    if (h == "javascript" || h == "js")     return Language::JAVASCRIPT;
    if (h == "java")                         return Language::JAVA;
    if (h == "rust" || h == "rs")           return Language::RUST;
    if (h == "go" || h == "golang")         return Language::GO;
    if (h == "typescript" || h == "ts")     return Language::TYPESCRIPT;
    if (h == "bash" || h == "sh")           return Language::BASH;
    if (h == "c#" || h == "csharp")         return Language::CSHARP;
    if (h == "kotlin" || h == "kt")         return Language::KOTLIN;

    // Heuristic auto-detect from code content
    if (code.find("#include") != std::string::npos) {
        if (code.find("std::") != std::string::npos ||
            code.find("cout")  != std::string::npos ||
            code.find("cin")   != std::string::npos ||
            code.find("vector") != std::string::npos)
            return Language::CPP;
        return Language::C;
    }
    if (code.find("def ") != std::string::npos ||
        code.find("import ") != std::string::npos ||
        code.find("print(") != std::string::npos)     return Language::PYTHON;
    if (code.find("public class") != std::string::npos) return Language::JAVA;
    if (code.find("fn main()") != std::string::npos)    return Language::RUST;
    if (code.find("func main()") != std::string::npos)  return Language::GO;
    if (code.find("console.log") != std::string::npos ||
        code.find("const ") != std::string::npos ||
        code.find("let ") != std::string::npos)         return Language::JAVASCRIPT;
    if (code.find("using System") != std::string::npos) return Language::CSHARP;
    if (code.find("fun main") != std::string::npos)     return Language::KOTLIN;

    return Language::PYTHON; // safe default
}

// ─────────────────────────────────────────────────────────────────────────────
ExecutionResult CodeExecutor::execute(const std::string& code, const std::string& langHint) {
    return execute(code, detectLanguage(code, langHint));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: does the output string look like an error?
// ─────────────────────────────────────────────────────────────────────────────
static bool looksLikeError(const std::string& out) {
    // Common error indicators across all languages
    const char* markers[] = {
        "error:", "Error:", "ERROR:",
        "exception", "Exception",
        "Traceback", "SyntaxError", "TypeError", "ValueError",
        "NameError", "AttributeError", "ImportError",
        "undefined reference", "linker error",
        "cannot find symbol", "ClassNotFoundException",
        "panic:", "FAILED", "fatal error",
        nullptr
    };
    for (int i = 0; markers[i]; i++) {
        if (out.find(markers[i]) != std::string::npos)
            return true;
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
ExecutionResult CodeExecutor::execute(const std::string& code, Language lang) {
    ExecutionResult result;
    result.language = languageName(lang);

    std::string tmp    = tempDir();
    std::string sep    = pathSep();
    std::string ext    = languageExtension(lang);
    std::string src    = writeTempFile(code, ext);
#ifdef _WIN32
    std::string outExe = tmp + sep + "ww_out.exe";
#else
    std::string outExe = tmp + sep + "ww_out";
#endif

    std::string runCmd;

    switch (lang) {
        // ── Python ───────────────────────────────────────────────────────────
        case Language::PYTHON:
            runCmd = "python3 \"" + src + "\" 2>&1";
#ifdef _WIN32
            runCmd = "python \"" + src + "\" 2>&1"; // Windows uses 'python'
#endif
            break;

        // ── C++ ──────────────────────────────────────────────────────────────
        case Language::CPP: {
            std::string co = runCommand("g++ -std=c++17 -o \"" + outExe + "\" \"" + src + "\" 2>&1");
            if (looksLikeError(co)) {
                result.errorOutput = co; result.exitCode = 1;
                deleteTempFile(src); return result;
            }
            runCmd = "\"" + outExe + "\" 2>&1";
            break;
        }

        // ── C ────────────────────────────────────────────────────────────────
        case Language::C: {
            std::string co = runCommand("gcc -o \"" + outExe + "\" \"" + src + "\" 2>&1");
            if (looksLikeError(co)) {
                result.errorOutput = co; result.exitCode = 1;
                deleteTempFile(src); return result;
            }
            runCmd = "\"" + outExe + "\" 2>&1";
            break;
        }

        // ── JavaScript ───────────────────────────────────────────────────────
        case Language::JAVASCRIPT:
            runCmd = "node \"" + src + "\" 2>&1";
            break;

        // ── TypeScript ───────────────────────────────────────────────────────
        case Language::TYPESCRIPT:
            runCmd = "ts-node \"" + src + "\" 2>&1";
            break;

        // ── Java ─────────────────────────────────────────────────────────────
        case Language::JAVA: {
            std::string co = runCommand("javac \"" + src + "\" 2>&1");
            if (looksLikeError(co)) {
                result.errorOutput = co; result.exitCode = 1;
                deleteTempFile(src); return result;
            }
            // Extract class name
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
            std::string co = runCommand("rustc -o \"" + outExe + "\" \"" + src + "\" 2>&1");
            if (looksLikeError(co)) {
                result.errorOutput = co; result.exitCode = 1;
                deleteTempFile(src); return result;
            }
            runCmd = "\"" + outExe + "\" 2>&1";
            break;
        }

        // ── Go ───────────────────────────────────────────────────────────────
        case Language::GO:
            runCmd = "go run \"" + src + "\" 2>&1";
            break;

        // ── C# ───────────────────────────────────────────────────────────────
        case Language::CSHARP: {
#ifdef _WIN32
            std::string co = runCommand("csc -out:\"" + outExe + "\" \"" + src + "\" 2>&1");
#else
            std::string co = runCommand("mcs -out:\"" + outExe + "\" \"" + src + "\" 2>&1");
#endif
            if (looksLikeError(co)) {
                result.errorOutput = co; result.exitCode = 1;
                deleteTempFile(src); return result;
            }
#ifdef _WIN32
            runCmd = "\"" + outExe + "\" 2>&1";
#else
            runCmd = "mono \"" + outExe + "\" 2>&1";
#endif
            break;
        }

        // ── Kotlin ───────────────────────────────────────────────────────────
        case Language::KOTLIN: {
            std::string jarOut = tmp + sep + "ww_out.jar";
            std::string co = runCommand("kotlinc \"" + src + "\" -include-runtime -d \"" + jarOut + "\" 2>&1");
            if (looksLikeError(co)) {
                result.errorOutput = co; result.exitCode = 1;
                deleteTempFile(src); return result;
            }
            runCmd = "java -jar \"" + jarOut + "\" 2>&1";
            break;
        }

        // ── Bash ─────────────────────────────────────────────────────────────
        case Language::BASH:
            runCmd = "bash \"" + src + "\" 2>&1";
            break;

        default:
            result.errorOutput = "[whyWhale] Unsupported language.";
            result.exitCode = 1;
            deleteTempFile(src);
            return result;
    }

    // Execute
    result.output = runCommand(runCmd);
    result.exitCode = 0;

    if (looksLikeError(result.output)) {
        result.errorOutput = result.output;
        result.success = false;
        result.exitCode = 1;
    } else {
        result.success = true;
    }

    deleteTempFile(src);
    std::remove(outExe.c_str());
    return result;
}