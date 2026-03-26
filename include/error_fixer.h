#pragma once
#include <string>
#include "ai_engine.h"
#include "code_executor.h"

struct FixResult {
    std::string finalCode;
    std::string finalOutput;
    bool succeeded = false;
    int attemptsUsed = 0;
};

class ErrorFixer {
public:
    ErrorFixer(AIEngine& ai, CodeExecutor& executor);

    // Run code → if error → ask AI to fix → repeat until clean or maxAttempts
    FixResult fixUntilClean(const std::string& code,
                            const std::string& language,
                            int maxAttempts = 10);

private:
    AIEngine& ai_;
    CodeExecutor& executor_;
};