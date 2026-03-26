#include "ollama_manager.h"
#include <iostream>
#include <string>
#include <cstdlib>
#include <fstream>
#include <thread>
#include <chrono>

#ifdef _WIN32
#include <windows.h>
#include <winsock2.h>
#pragma comment(lib, "ws2_32.lib")
#endif

// ─────────────────────────────────────────────────────────────────────────────
// Run a command and return its stdout as a string
// ─────────────────────────────────────────────────────────────────────────────
static std::string runCmd(const std::string& cmd) {
    std::string result;
    FILE* pipe = _popen((cmd + " 2>&1").c_str(), "r");
    if (!pipe) return "";
    char buf[256];
    while (fgets(buf, sizeof(buf), pipe))
        result += buf;
    _pclose(pipe);
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::isInstalled() {
    std::string out = runCmd("ollama --version");
    return out.find("ollama") != std::string::npos ||
           out.find("version") != std::string::npos;
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::install() {
    std::cout << "\n[whyWhale] Downloading Ollama installer for Windows...\n";

    // Use curl.exe (built into Windows 10/11) to download the installer
    std::string downloadCmd =
        "curl -L -o \"%TEMP%\\ollama-setup.exe\" "
        "https://ollama.ai/download/OllamaSetup.exe";

    int ret = std::system(downloadCmd.c_str());
    if (ret != 0) {
        std::cerr << "[whyWhale] Download failed. Please visit https://ollama.ai to install manually.\n";
        return false;
    }

    std::cout << "[whyWhale] Running Ollama installer (silent)...\n";
    ret = std::system("\"%TEMP%\\ollama-setup.exe\" /SILENT /NORESTART");

    if (ret != 0) {
        // Try non-silent in case silent flag isn't supported
        std::system("\"%TEMP%\\ollama-setup.exe\"");
    }

    // Wait for install to complete
    std::cout << "[whyWhale] Waiting for installation to complete...\n";
    for (int i = 0; i < 15; i++) {
        std::this_thread::sleep_for(std::chrono::seconds(2));
        if (isInstalled()) {
            std::cout << "[whyWhale] ✓ Ollama installed successfully!\n";
            return true;
        }
        std::cout << "  ... checking (" << (i+1) << "/15)\n";
    }

    std::cerr << "[whyWhale] Could not verify installation. Restart whyWhale after Ollama finishes installing.\n";
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::isServerRunning() {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2,2), &wsa);

    SOCKET sock = socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(11434);
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");

    bool running = (connect(sock, (sockaddr*)&addr, sizeof(addr)) == 0);
    closesocket(sock);
    WSACleanup();
    return running;
#else
    std::string out = runCmd("curl -s http://localhost:11434/api/tags");
    return !out.empty();
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
void OllamaManager::startServer() {
#ifdef _WIN32
    // Launch ollama serve in a detached process (no console window)
    STARTUPINFOA si = { sizeof(si) };
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi;

    std::string cmd = "ollama serve";
    std::vector<char> cmdBuf(cmd.begin(), cmd.end());
    cmdBuf.push_back('\0');

    CreateProcessA(nullptr, cmdBuf.data(), nullptr, nullptr,
                   FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
#else
    std::system("ollama serve &");
#endif

    std::cout << "[whyWhale] Starting Ollama server";
    for (int i = 0; i < 10; i++) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        std::cout << "." << std::flush;
        if (isServerRunning()) break;
    }
    std::cout << "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::isModelPulled(const std::string& model) {
    std::string out = runCmd("ollama list");
    return out.find(model) != std::string::npos;
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::pullModel(const std::string& model) {
    std::cout << "[whyWhale] Pulling model: " << model << "\n";
    std::cout << "[whyWhale] This may take several minutes depending on your internet speed...\n";
    std::cout << "[whyWhale] Model size ~4-5 GB — please wait...\n\n";

    int ret = std::system(("ollama pull " + model).c_str());

    if (ret == 0 || isModelPulled(model)) {
        std::cout << "\n[whyWhale] ✓ Model " << model << " is ready!\n";
        return true;
    }

    std::cerr << "[whyWhale] ✗ Failed to pull model. Check your internet connection.\n";
    return false;
}