#include "ai_engine.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <sstream>
#include <fstream>
#include <cstdlib>
#include <regex>

using json = nlohmann::json;

// ─────────────────────────────────────────────────────────────────────────────
AIEngine::AIEngine(const std::string& model) : model_(model) {}

void AIEngine::setModel(const std::string& model) { model_ = model; }
std::string AIEngine::getModel() const { return model_; }

// ─────────────────────────────────────────────────────────────────────────────
// POST JSON to Ollama HTTP API using curl.exe (built into Windows 10/11)
// ─────────────────────────────────────────────────────────────────────────────
std::string AIEngine::httpPost(const std::string& jsonBody) {
    // Write body to a temp file
    std::string tmpIn  = std::getenv("TEMP") ? std::string(std::getenv("TEMP")) + "\\ww_req.json"
                                              : "ww_req.json";
    std::string tmpOut = std::getenv("TEMP") ? std::string(std::getenv("TEMP")) + "\\ww_resp.json"
                                              : "ww_resp.json";

    {
        std::ofstream f(tmpIn);
        f << jsonBody;
    }

    std::string cmd = "curl -s -X POST http://localhost:11434/api/generate "
                      "-H \"Content-Type: application/json\" "
                      "-d @\"" + tmpIn + "\" "
                      "-o \"" + tmpOut + "\" 2>&1";

    std::system(cmd.c_str());

    // Read response file
    std::ifstream f(tmpOut);
    if (!f.is_open()) return "";

    std::string line, fullResponse;

    // Ollama returns one JSON object per line (streaming by default)
    // We set stream:false so we get one complete response
    while (std::getline(f, line)) {
        if (line.empty()) continue;
        try {
            auto obj = json::parse(line);
            if (obj.contains("response")) {
                fullResponse += obj["response"].get<std::string>();
            }
        } catch (...) {}
    }

    // Clean up temp files
    std::remove(tmpIn.c_str());
    std::remove(tmpOut.c_str());

    return fullResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract code from markdown code blocks  ```lang\n...\n```
// ─────────────────────────────────────────────────────────────────────────────
std::string AIEngine::extractCodeBlock(const std::string& response) {
    // Match ```(lang)?\n ... ``` blocks
    std::regex codeBlock("```[a-zA-Z]*\\n([\\s\\S]*?)```");
    std::smatch match;
    if (std::regex_search(response, match, codeBlock)) {
        return match[1].str();
    }
    // If no code block markers, return the whole response trimmed
    return response;
}

// ─────────────────────────────────────────────────────────────────────────────
std::string AIEngine::prompt(const std::string& systemMsg, const std::string& userMsg) {
    json body = {
        {"model",  model_},
        {"stream", false},
        {"system", systemMsg},
        {"prompt", userMsg}
    };

    std::string response = httpPost(body.dump());
    if (response.empty()) {
        return "[whyWhale ERROR] No response from Ollama. Is the server running?";
    }
    return response;
}

// ─────────────────────────────────────────────────────────────────────────────
std::string AIEngine::generateCode(const std::string& task, const std::string& language) {
    std::string systemMsg =
        "You are whyWhale, an expert software engineer. "
        "Your job is to write COMPLETE, CORRECT, RUNNABLE " + language + " code. "
        "Rules:\n"
        "1. Output ONLY the code inside a single ``` code block.\n"
        "2. No explanations before or after the code block.\n"
        "3. The code must compile and run without any errors.\n"
        "4. Handle all edge cases.\n"
        "5. Include all necessary imports/includes.\n"
        "6. Write production-quality code.";

    std::string userMsg = "Write " + language + " code to: " + task;

    std::string response = prompt(systemMsg, userMsg);
    return extractCodeBlock(response);
}

// ─────────────────────────────────────────────────────────────────────────────
std::string AIEngine::fixCode(const std::string& code,
                               const std::string& errorMsg,
                               const std::string& language) {
    std::string systemMsg =
        "You are whyWhale, an expert " + language + " debugger. "
        "You will receive broken code and its error output. "
        "Your job is to return a COMPLETELY FIXED, WORKING version. "
        "Rules:\n"
        "1. Output ONLY the fixed code inside a single ``` code block.\n"
        "2. Fix ALL syntax errors, logic errors, and runtime errors.\n"
        "3. Do not add explanations — only the corrected code.\n"
        "4. The fixed code must compile and run successfully.";

    std::string userMsg =
        "Fix this " + language + " code:\n\n"
        "```\n" + code + "\n```\n\n"
        "Error:\n" + errorMsg;

    std::string response = prompt(systemMsg, userMsg);
    return extractCodeBlock(response);
}