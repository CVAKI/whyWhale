#pragma once
#include <string>

class OllamaManager {
public:
    // Check if ollama.exe is installed on this machine
    bool isInstalled();

    // Download & silently install Ollama from official source
    bool install();

    // Check if the Ollama HTTP server is running on port 11434
    bool isServerRunning();

    // Launch `ollama serve` in background
    void startServer();

    // Check if a specific model has been pulled
    bool isModelPulled(const std::string& model);

    // Pull a model (e.g. "dolphin-llama3")
    bool pullModel(const std::string& model);
};