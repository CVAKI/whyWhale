#pragma once
#include <string>
#include <vector>
#include <atomic>
#include <mutex>
#include "ai_engine.h"
#include "code_executor.h"
#include "error_fixer.h"
#include "ollama_manager.h"

struct ChatMessage { bool isUser=false; std::string text; bool isCode=false; };
struct OpenTab     { std::string name, language; bool modified=false; };

class EditorUI {
public:
    void showBanner();
    void separator(const std::string& c="-", int w=60);
    void run(const std::string& model);

private:
    // ── Panels ──────────────────────────────────────────────────────────────
    void renderWelcomeScreen();
    void renderMenuBar();
    void renderToolbar();
    void renderActivityBar();   // NEW: left icon strip
    void renderFileTree();
    void renderCodeEditor();
    void renderAIPanel();
    void renderOutputPanel();
    void renderStatusBar();

    // ── Helpers ──────────────────────────────────────────────────────────────
    void applyTheme();
    void setupInitialDock(unsigned int dockId, float w, float h);
    void loadLogoTexture(const char* path);
    void doGenerate(const std::string& task, const std::string& lang);
    void doFix();
    void doRun();
    void appendOutput(const std::string& line, int type=0);
    std::string detectLang(const std::string& filename);

    // ── Engine pointers ───────────────────────────────────────────────────────
    AIEngine*      m_ai       = nullptr;
    CodeExecutor*  m_executor = nullptr;
    OllamaManager* m_ollama   = nullptr;

    std::string m_model;

    // ── Welcome ───────────────────────────────────────────────────────────────
    bool         m_showWelcome = true;
    unsigned int m_logoTexture = 0;
    int          m_logoW=0, m_logoH=0;

    // ── Editor ────────────────────────────────────────────────────────────────
    static constexpr int CODE_BUF = 1<<17; // 128 KB
    char        m_codeBuf[CODE_BUF] = {};
    char        m_taskBuf[1024]     = {};
    char        m_aiInputBuf[512]   = {};
    std::string m_language          = "Python";
    bool        m_editMode          = false; // false=syntax view, true=edit

    // ── Tabs ──────────────────────────────────────────────────────────────────
    std::vector<OpenTab> m_tabs;
    int m_activeTab = 0;

    // ── File tree ─────────────────────────────────────────────────────────────
    bool m_srcOpen=true, m_incOpen=true;
    int  m_actIcon=0;  // 0=files, 1=search, 2=ai, 3=settings

    // ── AI Chat ───────────────────────────────────────────────────────────────
    std::vector<ChatMessage> m_chat;
    std::atomic<bool> m_isGenerating{false};
    std::atomic<bool> m_isRunning{false};
    bool m_scrollChat=false, m_scrollOutput=false;
    int  m_aiTab=0;

    // ── Output ────────────────────────────────────────────────────────────────
    struct OutputLine { std::string text; int type; };
    std::vector<OutputLine> m_output;
    std::mutex              m_outputMutex;
    int  m_bottomTab=0, m_fixAttempt=0, m_errorCount=0;

    // ── Dock ──────────────────────────────────────────────────────────────────
    bool m_dockInit=false;

    // ── Status ────────────────────────────────────────────────────────────────
    int m_cursorLine=1, m_cursorCol=1;
    std::string m_buildStatus="Ready";
};