#pragma once
#include <string>

class AIEngine {
public:
    explicit AIEngine(const std::string& model = "dolphin-llama3");

    // Ask AI to generate code for a given task and language
    std::string generateCode(const std::string& task, const std::string& language);

    // Ask AI to fix broken code given the error message
    std::string fixCode(const std::string& code,
                        const std::string& errorMsg,
                        const std::string& language);

    // Raw prompt — returns full AI text response
    std::string prompt(const std::string& systemMsg, const std::string& userMsg);

    void setModel(const std::string& model);
    std::string getModel() const;

private:
    std::string model_;
    std::string httpPost(const std::string& jsonBody);
    std::string extractCodeBlock(const std::string& response);
};