#include "error_fixer.h"
#include <iostream>
#include <string>

ErrorFixer::ErrorFixer(AIEngine& ai, CodeExecutor& executor)
    : ai_(ai), executor_(executor) {}

// ─────────────────────────────────────────────────────────────────────────────
// Core self-healing loop:
//   1. Execute code
//   2. If error → ask AI to fix
//   3. Execute fixed code
//   4. Repeat until clean OR maxAttempts reached
// ─────────────────────────────────────────────────────────────────────────────
FixResult ErrorFixer::fixUntilClean(const std::string& code,
                                     const std::string& language,
                                     int maxAttempts) {
    FixResult result;
    result.finalCode = code;
    result.attemptsUsed = 0;

    std::string currentCode = code;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        result.attemptsUsed = attempt;

        std::cout << "\n  [🔁 whyWhale Fix Loop] Attempt " << attempt
                  << "/" << maxAttempts << "\n";
        std::cout << "  [▶ Executing " << language << " code...]\n";

        // Execute current code
        ExecutionResult execResult = executor_.execute(currentCode, language);

        // ── Success! ─────────────────────────────────────────────────────────
        if (execResult.success && execResult.errorOutput.empty()) {
            std::cout << "  [✓ Code ran successfully on attempt " << attempt << "!]\n";
            result.finalCode   = currentCode;
            result.finalOutput = execResult.output;
            result.succeeded   = true;
            return result;
        }

        // ── Error found — show it ─────────────────────────────────────────────
        std::string errorMsg = execResult.errorOutput.empty()
                               ? execResult.output
                               : execResult.errorOutput;

        std::cout << "\n  [✗ Error detected:]\n";
        std::cout << "  ----------------------------------------\n";
        // Print first 300 chars of error to avoid flooding terminal
        std::string preview = errorMsg.substr(0, std::min((int)errorMsg.size(), 300));
        std::cout << "  " << preview;
        if (errorMsg.size() > 300) std::cout << "\n  ... (truncated)";
        std::cout << "\n  ----------------------------------------\n";

        if (attempt == maxAttempts) {
            std::cout << "  [✗ Max attempts reached. Returning best code.]\n";
            result.finalCode   = currentCode;
            result.finalOutput = errorMsg;
            result.succeeded   = false;
            return result;
        }

        // ── Ask AI to fix ─────────────────────────────────────────────────────
        std::cout << "  [🤖 Asking AI to fix...]\n";
        std::string fixedCode = ai_.fixCode(currentCode, errorMsg, language);

        if (fixedCode.empty() || fixedCode == currentCode) {
            std::cout << "  [⚠ AI returned same code — trying different prompt...]\n";
            // Try a more forceful prompt
            fixedCode = ai_.fixCode(
                currentCode,
                "CRITICAL ERROR - The code completely fails with: " + errorMsg +
                "\nYou MUST rewrite it from scratch to make it work.",
                language
            );
        }

        currentCode = fixedCode;
        std::cout << "  [✓ AI provided a new version — retesting...]\n";
    }

    result.finalCode = currentCode;
    result.succeeded = false;
    return result;
}