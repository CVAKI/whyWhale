#include <iostream>
#include <thread>
#include <chrono>
#include "editor_ui.h"
#include "ollama_manager.h"

int main() {
    EditorUI ui;
    ui.showBanner();

    OllamaManager ollama;

    // ── Step 1: Check / Install Ollama ────────────────────────────────────────
    std::cout << "\033[36m  [whyWhale]\033[0m Checking Ollama installation...\n";

    if (!ollama.isInstalled()) {
        std::cout << "\033[33m  [whyWhale] Ollama not found. Auto-installing...\033[0m\n";
        if (!ollama.install()) {
            std::cerr << "\033[31m  [whyWhale] ✗ Ollama install failed.\033[0m\n"
                      << "  Please install manually: https://ollama.ai/download\n"
                      << "  Then restart whyWhale.\n";
            std::cout << "\n  Press Enter to exit...";
            std::cin.get();
            return 1;
        }
    } else {
        std::cout << "\033[32m  [whyWhale] ✓ Ollama is installed.\033[0m\n";
    }

    // ── Step 2: Start Ollama Server ───────────────────────────────────────────
    if (!ollama.isServerRunning()) {
        std::cout << "\033[36m  [whyWhale]\033[0m Starting Ollama server...\n";
        ollama.startServer();
        std::this_thread::sleep_for(std::chrono::seconds(3));

        if (!ollama.isServerRunning()) {
            std::cerr << "\033[31m  [whyWhale] ✗ Could not start Ollama server.\033[0m\n"
                      << "  Try running 'ollama serve' manually in a terminal.\n";
            std::cout << "\n  Press Enter to exit...";
            std::cin.get();
            return 1;
        }
    } else {
        std::cout << "\033[32m  [whyWhale] ✓ Ollama server is running.\033[0m\n";
    }

    // ── Step 3: Ensure Model is Available ────────────────────────────────────
    std::string model = "dolphin-llama3";

    if (!ollama.isModelPulled(model)) {
        std::cout << "\033[33m  [whyWhale] Model '" << model << "' not found.\033[0m\n";
        std::cout << "  \033[36mPulling now (first time only, ~4.7 GB)...\033[0m\n";

        if (!ollama.pullModel(model)) {
            // Fallback to codellama if dolphin-llama3 fails
            std::cout << "\033[33m  Trying fallback model: codellama...\033[0m\n";
            model = "codellama";
            if (!ollama.pullModel(model)) {
                std::cerr << "\033[31m  [whyWhale] ✗ Could not pull any model.\033[0m\n"
                          << "  Run manually: ollama pull dolphin-llama3\n";
                std::cout << "\n  Press Enter to exit...";
                std::cin.get();
                return 1;
            }
        }
    } else {
        std::cout << "\033[32m  [whyWhale] ✓ Model '" << model << "' is ready.\033[0m\n";
    }

    // ── Step 4: Launch Editor ─────────────────────────────────────────────────
    ui.run(model);

    return 0;
}