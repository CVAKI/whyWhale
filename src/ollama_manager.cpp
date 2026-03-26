#include "ollama_manager.h"
#include <iostream>
#include <string>
#include <cstdlib>
#include <fstream>
#include <thread>
#include <chrono>
#include <vector>

#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#include <shellapi.h>
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
// Find ollama.exe — checks PATH first, then the default install location
// ─────────────────────────────────────────────────────────────────────────────
static std::string getOllamaPath() {
#ifdef _WIN32
    // 1. Try PATH
    std::string out = runCmd("where ollama");
    if (out.find("ollama") != std::string::npos) {
        while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == ' '))
            out.pop_back();
        return out;
    }

    // 2. Try default install location
    const char* lad = std::getenv("LOCALAPPDATA");
    if (lad) {
        std::string defaultPath = std::string(lad) + "\\Programs\\Ollama\\ollama.exe";
        std::ifstream f(defaultPath);
        if (f.good()) return defaultPath;
    }
    return "";
#else
    std::string out = runCmd("which ollama");
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r'))
        out.pop_back();
    return (out.find("/") != std::string::npos) ? out : "";
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::isInstalled() {
    return !getOllamaPath().empty();
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::install() {
    std::cout << "\n  [whyWhale] Ollama not found. Auto-installing...\n";

#ifdef _WIN32
    const char* temp = std::getenv("TEMP");
    std::string tempDir   = temp ? temp : "C:\\Temp";
    std::string installer = tempDir + "\\OllamaSetup.exe";

    // ── Download ──────────────────────────────────────────────────────────────
    std::cout << "  [whyWhale] Downloading installer (~90 MB)...\n";
    std::string dlCmd =
        "curl -L --progress-bar "
        "-o \"" + installer + "\" "
        "https://ollama.com/download/OllamaSetup.exe";

    std::system(dlCmd.c_str());

    // Verify download
    {
        std::ifstream f(installer, std::ios::ate | std::ios::binary);
        if (!f.good() || f.tellg() < 50000) {
            std::cerr << "  [whyWhale] ✗ Download failed or file is too small.\n";
            std::cerr << "  Please download manually: https://ollama.com/download\n";
            return false;
        }
    }

    // ── Run installer silently via ShellExecuteEx ─────────────────────────────
    std::cout << "  [whyWhale] Running installer (may request admin rights)...\n";

    SHELLEXECUTEINFOA sei{};
    sei.cbSize       = sizeof(sei);
    sei.fMask        = SEE_MASK_NOCLOSEPROCESS;
    sei.lpVerb       = "runas";                        // elevate if needed
    sei.lpFile       = installer.c_str();
    sei.lpParameters = "/SILENT /NORESTART /CLOSEAPPLICATIONS";
    sei.nShow        = SW_HIDE;

    if (!ShellExecuteExA(&sei)) {
        // Try without elevation
        sei.lpVerb = nullptr;
        ShellExecuteExA(&sei);
    }

    // Wait for installer process to finish
    std::cout << "  [whyWhale] Installing";
    if (sei.hProcess) {
        WaitForSingleObject(sei.hProcess, 120000); // max 2 min
        CloseHandle(sei.hProcess);
    } else {
        for (int i = 0; i < 30; i++) {
            std::this_thread::sleep_for(std::chrono::seconds(2));
            std::cout << "." << std::flush;
            if (isInstalled()) break;
        }
    }
    std::cout << "\n";

    // ── Refresh PATH in this process from the registry ────────────────────────
    DWORD sz = 0;
    RegGetValueA(HKEY_LOCAL_MACHINE,
        "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
        "Path", RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ, nullptr, nullptr, &sz);
    if (sz > 0) {
        std::string newPath(sz, '\0');
        if (RegGetValueA(HKEY_LOCAL_MACHINE,
                "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
                "Path", RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ,
                nullptr, &newPath[0], &sz) == ERROR_SUCCESS)
            SetEnvironmentVariableA("PATH", newPath.c_str());
    }

    // ── Also add known install dir to PATH for this session ───────────────────
    const char* lad = std::getenv("LOCALAPPDATA");
    if (lad) {
        std::string ollamaDir   = std::string(lad) + "\\Programs\\Ollama";
        std::string currentPath = std::getenv("PATH") ? std::getenv("PATH") : "";
        SetEnvironmentVariableA("PATH", (ollamaDir + ";" + currentPath).c_str());
    }

#else
    // Linux / macOS
    std::cout << "  [whyWhale] Running: curl -fsSL https://ollama.com/install.sh | sh\n";
    if (std::system("curl -fsSL https://ollama.com/install.sh | sh") != 0) {
        std::cerr << "  [whyWhale] ✗ Install failed. Try: https://ollama.com\n";
        return false;
    }
#endif

    if (isInstalled()) {
        std::cout << "  [whyWhale] ✓ Ollama installed successfully!\n";
        return true;
    }

    std::cerr << "  [whyWhale] ✗ Could not verify installation.\n";
    std::cerr << "  Restart whyWhale after the installer finishes.\n";
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::isServerRunning() {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
    SOCKET sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock == INVALID_SOCKET) { WSACleanup(); return false; }

    DWORD timeout = 1500;
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
void OllamaManager::startServer() {
    if (isServerRunning()) return;

    std::string exe = getOllamaPath();
    if (exe.empty()) exe = "ollama";

#ifdef _WIN32
    std::string cmdLine = "\"" + exe + "\" serve";
    std::vector<char> buf(cmdLine.begin(), cmdLine.end());
    buf.push_back('\0');

    STARTUPINFOA si{};
    PROCESS_INFORMATION pi{};
    si.cb          = sizeof(si);
    si.dwFlags     = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    BOOL ok = CreateProcessA(nullptr, buf.data(),
        nullptr, nullptr, FALSE,
        CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP,
        nullptr, nullptr, &si, &pi);

    if (ok) {
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    } else {
        WinExec(cmdLine.c_str(), SW_HIDE);
    }
#else
    std::system(("nohup \"" + exe + "\" serve > /dev/null 2>&1 &").c_str());
#endif

    std::cout << "  [whyWhale] Starting Ollama server";
    for (int i = 0; i < 30; i++) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        std::cout << "." << std::flush;
        if (isServerRunning()) { std::cout << " ✓\n"; return; }
    }
    std::cout << "\n  [whyWhale] ✗ Server did not start in time.\n";
    std::cout << "  → Run 'ollama serve' manually, then relaunch.\n";
}

// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::isModelPulled(const std::string& model) {
    std::string exe = getOllamaPath();
    if (exe.empty()) exe = "ollama";

    std::string out = runCmd("\"" + exe + "\" list");
    std::string base = model;
    auto c = base.find(':');
    if (c != std::string::npos) base = base.substr(0, c);
    return out.find(base) != std::string::npos;
}

// ─────────────────────────────────────────────────────────────────────────────
// pullModel — retries up to MAX_RETRIES times on network failure.
// Ollama resumes partial downloads automatically on each retry,
// so repeated calls will make forward progress even on unstable connections.
// ─────────────────────────────────────────────────────────────────────────────
bool OllamaManager::pullModel(const std::string& model) {
    std::string exe = getOllamaPath();
    if (exe.empty()) exe = "ollama";

    const int MAX_RETRIES   = 15;          // retry up to 15 times
    const int RETRY_DELAY_S = 5;           // wait 5 seconds between retries

    std::cout << "  [whyWhale] Pulling model '" << model << "'...\n";
    std::cout << "  [whyWhale] If your connection drops, whyWhale will\n";
    std::cout << "             automatically retry and RESUME — don't worry!\n\n";

    for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {

        // Already done? (e.g. completed on a previous app run)
        if (isModelPulled(model)) {
            std::cout << "\n  [whyWhale] ✓ Model '" << model << "' is ready!\n";
            return true;
        }

        std::cout << "  [whyWhale] Download attempt " << attempt
                  << " / " << MAX_RETRIES << "\n\n";

        // Run `ollama pull` — Ollama stores blobs in ~/.ollama/models/blobs/
        // and resumes incomplete ones automatically on the next call.
        std::system(("\"" + exe + "\" pull " + model).c_str());

        // Check if it finished cleanly
        if (isModelPulled(model)) {
            std::cout << "\n  [whyWhale] ✓ Model '" << model << "' ready!\n";
            return true;
        }

        // Pull failed / interrupted — wait then retry
        if (attempt < MAX_RETRIES) {
            std::cout << "\n  [whyWhale] ⚠ Download interrupted (attempt "
                      << attempt << "/" << MAX_RETRIES << ").\n";
            std::cout << "  [whyWhale] Resuming in " << RETRY_DELAY_S
                      << " seconds... (progress is saved, don't close the window)\n";

            for (int s = RETRY_DELAY_S; s > 0; s--) {
                std::cout << "  " << s << "...\r" << std::flush;
                std::this_thread::sleep_for(std::chrono::seconds(1));
            }
            std::cout << "\n";
        }
    }

    std::cerr << "\n  [whyWhale] ✗ Failed to download '" << model
              << "' after " << MAX_RETRIES << " attempts.\n";
    std::cerr << "  Tips:\n";
    std::cerr << "    • Use a wired (ethernet) connection instead of Wi-Fi\n";
    std::cerr << "    • Run manually in a terminal: ollama pull " << model << "\n";
    std::cerr << "      (You can re-run it as many times as needed — it always resumes)\n";
    return false;
}