#pragma once
#include <string>
#include "ai_engine.h"
#include "code_executor.h"
#include "error_fixer.h"
#include "ollama_manager.h"

class EditorUI {
public:
    // Print the whyWhale ASCII banner
    void showBanner();

    // Print a section separator
    void separator(char c = '-', int width = 60);

    // Main run loop — handles all user interaction
    void run(const std::string& model);

private:
    void handleNewTask(AIEngine& ai, CodeExecutor& executor, ErrorFixer& fixer);
    void handleFixCode(AIEngine& ai, CodeExecutor& executor, ErrorFixer& fixer);
    void handleSettings(AIEngine& ai, OllamaManager& ollama);
    void showHelp();

    std::string readMultilineInput(const std::string& prompt);
    std::string selectLanguage();
    void printCode(const std::string& code, const std::string& lang);
    void printResult(const ExecutionResult& result);
    void printFixProgress(int attempt, int max);
};