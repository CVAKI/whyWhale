#include "editor_ui.h"
#include "ollama_manager.h"
#include <iostream>
#include <string>
#include <limits>

#ifdef _WIN32
#include <windows.h>
static void setupConsole() {
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
    HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD mode = 0;
    if (GetConsoleMode(h, &mode))
        SetConsoleMode(h, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
}
#else
static void setupConsole() {}
#endif

// ─────────────────────────────────────────────────────────────────────────────
// The best uncensored, fast, code-capable models (in order of preference).
// dolphin-mixtral is the fastest uncensored; dolphin-llama3 is fallback.
// ─────────────────────────────────────────────────────────────────────────────
static const std::string PREFERRED_MODEL  = "dolphin-mixtral";
static const std::string FALLBACK_MODEL   = "dolphin-llama3";

// ─────────────────────────────────────────────────────────────────────────────
static void waitEnter() {
    std::cout << "\n  Press Enter to exit...";
    std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');
    std::cin.get();
}

// ─────────────────────────────────────────────────────────────────────────────
int main() {
    setupConsole();

    EditorUI ui;
    ui.showBanner();

    OllamaManager ollama;

    // ── Step 1: Ensure Ollama is installed ──────────────────────────────────
    std::cout << "  [whyWhale] Checking Ollama installation...\n";
    if (!ollama.isInstalled()) {
        std::cout << "  [whyWhale] Ollama not found. Installing automatically...\n";
        if (!ollama.install()) {
            std::cout << "\033[31m  [whyWhale] ✗ Ollama installation failed.\033[0m\n";
            std::cout << "  Please install Ollama from https://ollama.ai and re-run whyWhale.\n";
            waitEnter();
            return 1;
        }
    }
    std::cout << "  [whyWhale] ✓ Ollama is installed.\n";

    // ── Step 2: Start Ollama server if not running ───────────────────────────
    if (!ollama.isServerRunning()) {
        std::cout << "  [whyWhale] Starting Ollama server...\n";
        ollama.startServer();
        if (!ollama.isServerRunning()) {
            std::cout << "\033[31m  [whyWhale] ✗ Could not start Ollama server.\033[0m\n";
            std::cout << "  Try running 'ollama serve' manually in a new terminal,\n";
            std::cout << "  then restart whyWhale.\n";
            waitEnter();
            return 1;
        }
    }
    std::cout << "  [whyWhale] ✓ Ollama server is running.\n";

    // ── Step 3: Ensure preferred model is available ──────────────────────────
    std::string activeModel;

    if (ollama.isModelPulled(PREFERRED_MODEL)) {
        activeModel = PREFERRED_MODEL;
        std::cout << "  [whyWhale] ✓ Model '" << activeModel << "' is ready.\n";
    } else if (ollama.isModelPulled(FALLBACK_MODEL)) {
        activeModel = FALLBACK_MODEL;
        std::cout << "  [whyWhale] ✓ Model '" << activeModel << "' is ready.\n";
    } else {
        // Auto-pull the preferred model
        std::cout << "\n  [whyWhale] No uncensored model found.\n";
        std::cout << "  [whyWhale] Auto-downloading '" << PREFERRED_MODEL << "'...\n";
        std::cout << "  [whyWhale] This is a one-time download (~8 GB). Please wait.\n\n";

        if (ollama.pullModel(PREFERRED_MODEL)) {
            activeModel = PREFERRED_MODEL;
        } else {
            // Try fallback
            std::cout << "  [whyWhale] Trying fallback model '" << FALLBACK_MODEL << "'...\n";
            if (ollama.pullModel(FALLBACK_MODEL)) {
                activeModel = FALLBACK_MODEL;
            } else {
                std::cout << "\033[31m  [whyWhale] ✗ Could not pull any model.\033[0m\n";
                std::cout << "  Try manually: ollama pull dolphin-llama3\n";
                waitEnter();
                return 1;
            }
        }
    }

    // ── Step 4: Launch the editor ────────────────────────────────────────────
    ui.run(activeModel);
    return 0;
}