#pragma once
#include <string>

enum class Language {
    CPP, C, PYTHON, JAVASCRIPT, JAVA, RUST, GO, TYPESCRIPT,
    BASH, CSHARP, KOTLIN, SWIFT, UNKNOWN
};

struct ExecutionResult {
    std::string output;
    std::string errorOutput;
    int exitCode = 0;
    bool success = false;
    std::string language;
};

class CodeExecutor {
public:
    // Detect language from code content or file extension hint
    Language detectLanguage(const std::string& code, const std::string& hint = "");

    // Execute code in any supported language
    ExecutionResult execute(const std::string& code, Language lang);
    ExecutionResult execute(const std::string& code, const std::string& langHint = "");

    // Convert Language enum to string name
    static std::string languageName(Language lang);

    // Get file extension for language
    static std::string languageExtension(Language lang);

private:
    std::string runCommand(const std::string& cmd);
    std::string writeTempFile(const std::string& code, const std::string& ext);
    void deleteTempFile(const std::string& path);
};