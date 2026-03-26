#include "ollama_manager.h"
#include <iostream>
#include <string>
#include <cstdlib>
#include <fstream>
#include <thread>
#include <chrono>

#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#pragma comment(lib, "ws2_32.lib")
#endif

// ─────────────────────────────────────────────────────────────────────────────
static std::string runCmd(const std::string& cmd) {
    std::string result;
#ifdef _WIN32
    FILE* pipe = _popen((cmd + " 2>&1").c_str(), "r");
#else
    FILE* pipe = popen((cmd + " 2>&1").c_str(), "r");
#endif
    if (!pipe) return "";
    char buf[256];
    while (fgets(buf, sizeof(buf), pipe))
        result += buf;
#ifdef _WIN32
    _pclose(pipe);
#else
    pclose(pipe);
#endif
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
    std::cout << "\n[whyWhale] Downloading Ollama installer...\n";

#ifdef _WIN32
    std::string downloadCmd =
        "curl -L -o \"%TEMP%\\ollama-setup.exe\" "
        "https://ollama.ai/download/OllamaSetup.exe";
    int ret = std::system(downloadCmd.c_str());
    if (ret != 0) {
        std::cerr << "[whyWhale] Download failed. Visit https://ollama.ai to install manually.\n";
        return false;
    }
    std::cout << "[whyWhale] Running Ollama installer...\n";
    // Try silent first, fallback to interactive
    if (std::system("\"%TEMP%\\ollama-setup.exe\" /SILENT /NORESTART") != 0)
        std::system("\"%TEMP%\\ollama-setup.exe\"");
#else
    // Linux/macOS: use the official install script
    int ret = std::system("curl -fsSL https://ollama.ai/install.sh | sh");
    if (ret != 0) {
        std::cerr << "[whyWhale] Install failed. Visit https://ollama.ai to install manually.\n";
        return false;
    }
#endif

    std::cout << "[whyWhale] Waiting for installation to complete";
    for (int i = 0; i < 15; i++) {
        std::this_thread::sleep_for(std::chrono::seconds(2));
        std::cout << "." << std::flush;
        if (isInstalled()) {
            std::cout << " ✓\n";
            return true;
        }
    }
    std::cerr << "\n[whyWhale] Could not verify. Restart whyWhale after Ollama finishes installing.\n";
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::isServerRunning() {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
    SOCKET sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock == INVALID_SOCKET) { WSACleanup(); return false; }

    DWORD timeout = 1000;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, (const char*)&timeout, sizeof(timeout));

    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_port        = htons(11434);
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");

    bool running = (connect(sock, (sockaddr*)&addr, sizeof(addr)) == 0);
    closesocket(sock);
    WSACleanup();
    return running;
#else
    std::string out = runCmd("curl -s --max-time 2 http://localhost:11434/api/tags");
    return !out.empty();
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
// KEY FIX: Use CreateProcess on Windows instead of std::system / cmd /c start.
// std::system("start ...") from a compiled EXE does NOT reliably spawn
// background processes — CreateProcess bypasses the shell entirely.
// ─────────────────────────────────────────────────────────────────────────────
void OllamaManager::startServer() {
    if (isServerRunning()) return; // already up

#ifdef _WIN32
    STARTUPINFOA si{};
    PROCESS_INFORMATION pi{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE; // hide the console window

    // CreateProcess needs a non-const char* for command line
    char cmd[] = "ollama serve";
    BOOL ok = CreateProcessA(
        nullptr,   // no explicit exe path — find via PATH
        cmd,       // command line
        nullptr,   // default process security
        nullptr,   // default thread security
        FALSE,     // don't inherit handles
        CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP,
        nullptr,   // inherit environment
        nullptr,   // inherit working directory
        &si, &pi
    );

    if (!ok) {
        // Fallback: try WinExec (older but reliable)
        WinExec("ollama serve", SW_HIDE);
    } else {
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }
#else
    std::system("nohup ollama serve > /dev/null 2>&1 &");
#endif

    // Poll up to 30 seconds
    std::cout << "[whyWhale] Starting Ollama server";
    for (int i = 0; i < 30; i++) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        std::cout << "." << std::flush;
        if (isServerRunning()) {
            std::cout << " ✓\n";
            return;
        }
    }
    std::cout << "\n[whyWhale] ✗ Could not confirm server start.\n";
    std::cout << "  → Try running 'ollama serve' manually in a terminal, then relaunch.\n";
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::isModelPulled(const std::string& model) {
    std::string out = runCmd("ollama list");
    // model name may appear as "dolphin-llama3:latest" even if user typed "dolphin-llama3"
    std::string baseName = model;
    auto colon = baseName.find(':');
    if (colon != std::string::npos) baseName = baseName.substr(0, colon);
    return out.find(baseName) != std::string::npos;
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::pullModel(const std::string& model) {
    std::cout << "[whyWhale] Pulling model: " << model << "\n";
    std::cout << "[whyWhale] This may take several minutes (~4-8 GB)... please wait.\n\n";

    int ret = std::system(("ollama pull " + model).c_str());

    if (ret == 0 || isModelPulled(model)) {
        std::cout << "\n[whyWhale] ✓ Model '" << model << "' is ready!\n";
        return true;
    }
    std::cerr << "[whyWhale] ✗ Failed to pull model. Check your internet connection.\n";
    return false;
}