#include "editor_ui.h"
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <imgui_internal.h>          // DockBuilder*, SeparatorEx
#include <GLFW/glfw3.h>
// GL_CLAMP_TO_EDGE is OpenGL 1.2+; MinGW's gl.h only exposes 1.1
#ifndef GL_CLAMP_TO_EDGE
#  define GL_CLAMP_TO_EDGE 0x812F
#endif
#include <iostream>
#include <sstream>
#include <cstring>
#include <thread>
#include <algorithm>
#include <cmath>

// stb_image  — single-header PNG loader
#define STB_IMAGE_IMPLEMENTATION
#include <stb_image.h>

// ─────────────────────────────────────────────────────────────────────────────
// Colour palette  (inspired by the whyWhale logo: deep-blue, orange, teal)
// ─────────────────────────────────────────────────────────────────────────────
#define C_BG0    ImVec4(0.078f,0.082f,0.094f,1)   // #14151a  deepest bg
#define C_BG1    ImVec4(0.137f,0.141f,0.161f,1)   // #232429  panel bg
#define C_BG2    ImVec4(0.180f,0.188f,0.212f,1)   // #2e3036  row hover
#define C_ACCENT ImVec4(0.310f,0.765f,0.969f,1)   // #4fc3f7  logo teal
#define C_ORANGE ImVec4(1.000f,0.420f,0.000f,1)   // #ff6b00  logo orange
#define C_GREEN  ImVec4(0.412f,0.941f,0.682f,1)   // #69f0ae
#define C_RED    ImVec4(1.000f,0.322f,0.322f,1)   // #ff5252
#define C_YELLOW ImVec4(1.000f,0.843f,0.251f,1)   // #ffd740
#define C_DIM    ImVec4(0.380f,0.396f,0.440f,1)   // dim text
#define C_TXT    ImVec4(0.871f,0.882f,0.898f,1)   // #dfe1e5
#define C_PURPLE ImVec4(0.800f,0.600f,0.900f,1)   // keywords
#define C_TEAL   ImVec4(0.306f,0.788f,0.690f,1)   // types
#define C_STR    ImVec4(0.494f,0.784f,0.627f,1)   // strings
#define C_CMT    ImVec4(0.416f,0.600f,0.333f,1)   // comments
#define C_FN     ImVec4(0.863f,0.863f,0.671f,1)   // functions

// Draw-list colours (IM_COL32 equivalents of the above)
#define COL_ACCENT  IM_COL32( 79,195,247,255)
#define COL_ORANGE  IM_COL32(255,107,  0,255)
#define COL_TXT     IM_COL32(222,225,229,255)
#define COL_DIM     IM_COL32( 97,101,110,255)
#define COL_BORDER  IM_COL32( 50, 54, 62,255)

// ─────────────────────────────────────────────────────────────────────────────
// Per-line syntax colour heuristic
// ─────────────────────────────────────────────────────────────────────────────
[[maybe_unused]] static ImVec4 lineColor(const char* line) {
    const char* p = line;
    while (*p==' '||*p=='\t') ++p;
    if (!*p) return C_TXT;
    if (p[0]=='/'&&p[1]=='/') return C_CMT;
    if (p[0]=='#') return ImVec4(0.78f,0.525f,0.753f,1);
    static const char* kw[]={
        "if ","else","for ","while ","return ","bool ","int ","void ",
        "const ","auto ","static ","class ","struct ","true","false",
        "nullptr","using ","break","continue","switch","case ","new ",
        "delete ","public:","private:","protected:","virtual","override",nullptr};
    for(int i=0;kw[i];++i)
        if(strncmp(p,kw[i],strlen(kw[i]))==0) return C_PURPLE;
    static const char* ty[]={
        "std::string","std::vector","std::mutex","std::thread","std::atomic",
        "BOOL ","DWORD ","HANDLE ","SOCKET ","HWND ",nullptr};
    for(int i=0;ty[i];++i)
        if(strstr(line,ty[i])) return C_TEAL;
    if(strchr(line,'"')||strchr(line,'\'')) return C_STR;
    return C_TXT;
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::showBanner() { std::cout<<"[whyWhale] Launching IDE...\n"; }
void EditorUI::separator(const std::string&,int) {}

// ─────────────────────────────────────────────────────────────────────────────
// Load PNG → OpenGL texture.  Call after glfwMakeContextCurrent.
// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::loadLogoTexture(const char* path) {
    stbi_set_flip_vertically_on_load(false);
    int w,h,ch;
    unsigned char* data = stbi_load(path,&w,&h,&ch,4);
    if (!data) return;

    unsigned int tex;
    glGenTextures(1,&tex);
    glBindTexture(GL_TEXTURE_2D,tex);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,w,h,0,GL_RGBA,GL_UNSIGNED_BYTE,data);
    stbi_image_free(data);
    m_logoTexture=tex; m_logoW=w; m_logoH=h;
    std::cout<<"[whyWhale] Logo loaded ("<<w<<"x"<<h<<")\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme — dark Android-Studio-style with logo palette
// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::applyTheme() {
    ImGuiStyle& s = ImGui::GetStyle();
    s.WindowRounding    = 0;
    s.ChildRounding     = 6;
    s.FrameRounding     = 5;
    s.PopupRounding     = 6;
    s.ScrollbarRounding = 4;
    s.GrabRounding      = 4;
    s.TabRounding       = 5;
    s.FramePadding      = {8,5};
    s.ItemSpacing       = {8,6};
    s.WindowPadding     = {10,10};
    s.ScrollbarSize     = 11;
    s.WindowBorderSize  = 1;
    s.ChildBorderSize   = 1;
    s.FrameBorderSize   = 0;
    s.TabBarBorderSize  = 1;
    s.IndentSpacing     = 18;

    ImVec4* c = s.Colors;
    c[ImGuiCol_WindowBg]            = C_BG0;
    c[ImGuiCol_ChildBg]             = C_BG0;
    c[ImGuiCol_PopupBg]             = C_BG1;
    c[ImGuiCol_Border]              = ImVec4(0.21f,0.22f,0.25f,1);
    c[ImGuiCol_FrameBg]             = C_BG1;
    c[ImGuiCol_FrameBgHovered]      = C_BG2;
    c[ImGuiCol_FrameBgActive]       = ImVec4(0.22f,0.23f,0.26f,1);
    c[ImGuiCol_TitleBg]             = C_BG1;
    c[ImGuiCol_TitleBgActive]       = C_BG1;
    c[ImGuiCol_TitleBgCollapsed]    = C_BG1;
    c[ImGuiCol_MenuBarBg]           = ImVec4(0.10f,0.10f,0.12f,1);
    c[ImGuiCol_ScrollbarBg]         = C_BG0;
    c[ImGuiCol_ScrollbarGrab]       = ImVec4(0.28f,0.30f,0.34f,1);
    c[ImGuiCol_ScrollbarGrabHovered]= ImVec4(0.34f,0.36f,0.40f,1);
    c[ImGuiCol_ScrollbarGrabActive] = ImVec4(0.38f,0.40f,0.44f,1);
    c[ImGuiCol_CheckMark]           = C_ACCENT;
    c[ImGuiCol_SliderGrab]          = C_ACCENT;
    c[ImGuiCol_SliderGrabActive]    = C_ACCENT;
    c[ImGuiCol_Button]              = ImVec4(0.21f,0.22f,0.26f,1);
    c[ImGuiCol_ButtonHovered]       = ImVec4(0.31f,0.765f,0.969f,0.22f);
    c[ImGuiCol_ButtonActive]        = ImVec4(0.31f,0.765f,0.969f,0.42f);
    c[ImGuiCol_Header]              = ImVec4(0.17f,0.34f,0.54f,1);
    c[ImGuiCol_HeaderHovered]       = ImVec4(0.20f,0.37f,0.57f,1);
    c[ImGuiCol_HeaderActive]        = ImVec4(0.17f,0.34f,0.54f,1);
    c[ImGuiCol_Separator]           = ImVec4(0.20f,0.21f,0.24f,1);
    c[ImGuiCol_SeparatorHovered]    = C_ACCENT;
    c[ImGuiCol_SeparatorActive]     = C_ACCENT;
    c[ImGuiCol_ResizeGrip]          = ImVec4(0.31f,0.765f,0.969f,0.12f);
    c[ImGuiCol_ResizeGripHovered]   = ImVec4(0.31f,0.765f,0.969f,0.42f);
    c[ImGuiCol_ResizeGripActive]    = ImVec4(0.31f,0.765f,0.969f,0.68f);
    c[ImGuiCol_Tab]                 = ImVec4(0.115f,0.12f,0.135f,1);
    c[ImGuiCol_TabHovered]          = ImVec4(0.31f,0.765f,0.969f,0.22f);
    c[ImGuiCol_TabActive]           = C_BG0;
    c[ImGuiCol_TabUnfocused]        = ImVec4(0.115f,0.12f,0.135f,1);
    c[ImGuiCol_TabUnfocusedActive]  = C_BG0;
    c[ImGuiCol_DockingPreview]      = ImVec4(0.31f,0.765f,0.969f,0.22f);
    c[ImGuiCol_DockingEmptyBg]      = C_BG0;
    c[ImGuiCol_Text]                = C_TXT;
    c[ImGuiCol_TextDisabled]        = C_DIM;
    c[ImGuiCol_TextSelectedBg]      = ImVec4(0.31f,0.765f,0.969f,0.28f);
    c[ImGuiCol_NavHighlight]        = C_ACCENT;
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial dock layout
// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::setupInitialDock(unsigned int id, float w, float h) {
    ImGui::DockBuilderRemoveNode(id);
    ImGui::DockBuilderAddNode(id, ImGuiDockNodeFlags_DockSpace);
    ImGui::DockBuilderSetNodeSize(id, ImVec2(w,h));

    ImGuiID left,center,right,bottom;
    ImGui::DockBuilderSplitNode(id,     ImGuiDir_Left,  0.18f, &left,   &center);
    ImGui::DockBuilderSplitNode(center, ImGuiDir_Right, 0.27f, &right,  &center);
    ImGui::DockBuilderSplitNode(center, ImGuiDir_Down,  0.28f, &bottom, &center);

    ImGui::DockBuilderDockWindow("Project",      left);
    ImGui::DockBuilderDockWindow("Code Editor",  center);
    ImGui::DockBuilderDockWindow("AI Assistant", right);
    ImGui::DockBuilderDockWindow("Output",       bottom);
    ImGui::DockBuilderFinish(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Output log helper
// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::appendOutput(const std::string& line, int type) {
    std::lock_guard<std::mutex> lk(m_outputMutex);
    m_output.push_back({line,type});
    m_scrollOutput = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Async: generate code
// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::doGenerate(const std::string& task, const std::string& lang) {
    if (m_isGenerating.load()) return;
    m_isGenerating=true; m_buildStatus="Generating...";
    appendOutput("[whyWhale] Generating "+lang+" code…",0);
    m_chat.push_back({false,"Generating "+lang+" code for: "+task+" …",false});
    m_scrollChat=true;

    std::thread([this,task,lang](){
        std::string code = m_ai->generateCode(task,lang);
        {
            std::lock_guard<std::mutex> lk(m_outputMutex);
            if(code.empty()){
                m_output.push_back({"[ERROR] No response from Ollama. Is it running?",2});
                m_chat.push_back({false,"Failed. Is Ollama running?",false});
            } else {
                strncpy(m_codeBuf,code.c_str(),CODE_BUF-1);
                if(!m_tabs.empty()){m_tabs[m_activeTab].language=lang;m_tabs[m_activeTab].modified=true;}
                m_output.push_back({"[whyWhale] Code generated! Running fix loop…",0});
                m_chat.push_back({false,"Code generated! Running the self-healing loop…",false});
            }
            m_scrollOutput=m_scrollChat=true;
        }
        if(!code.empty()){
            ExecutionResult r=m_executor->execute(code,lang);
            if(r.success){
                appendOutput("[OK] Code ran successfully on first try!",1);
                m_chat.push_back({false,"Code ran successfully!\nOutput:\n"+r.output,false});
            } else {
                appendOutput("[FIX] Error detected. AI is auto-fixing…",3);
                int att=1; std::string cur=code;
                while(att<=10){
                    appendOutput("[FIX] Attempt "+std::to_string(att)+"/10",0);
                    std::string fixed=m_ai->fixCode(cur,r.errorOutput.empty()?r.output:r.errorOutput,lang);
                    if(fixed.empty()) break;
                    cur=fixed; r=m_executor->execute(cur,lang);
                    if(r.success){
                        std::lock_guard<std::mutex> lk2(m_outputMutex);
                        strncpy(m_codeBuf,cur.c_str(),CODE_BUF-1);
                        m_output.push_back({"[OK] Fixed in "+std::to_string(att)+" attempt(s)!",1});
                        m_chat.push_back({false,"Fixed in "+std::to_string(att)+" attempt(s)!\nOutput:\n"+r.output,false});
                        m_scrollChat=m_scrollOutput=true;
                        break;
                    }
                    ++att;
                }
                if(!r.success) appendOutput("[ERR] Could not fix after 10 attempts.",2);
            }
        }
        m_buildStatus="Ready"; m_isGenerating=false;
    }).detach();
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::doRun() {
    if(m_isRunning.load()||m_isGenerating.load()) return;
    m_isRunning=true; m_buildStatus="Running..."; m_bottomTab=0;
    std::string code(m_codeBuf), lang=m_language;
    appendOutput("──── Run ────────────────────────────────",4);
    std::thread([this,code,lang](){
        ExecutionResult r=m_executor->execute(code,lang);
        if(r.success){
            appendOutput(r.output.empty()?"(no output)":r.output,1);
            appendOutput("[OK] Execution successful.",1);
            m_buildStatus="Run OK";
        } else {
            appendOutput(r.errorOutput.empty()?r.output:r.errorOutput,2);
            appendOutput("[ERR] Execution failed.",2);
            m_buildStatus="Error"; ++m_errorCount;
        }
        m_isRunning=false;
    }).detach();
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::doFix() {
    if(m_isGenerating.load()) return;
    m_isGenerating=true; m_buildStatus="Auto-fixing..."; m_bottomTab=3;
    std::string code(m_codeBuf), lang=m_language;
    appendOutput("──── Auto Fix ───────────────────────────",4);
    std::thread([this,code,lang](){
        ExecutionResult r=m_executor->execute(code,lang);
        if(r.success){
            appendOutput("[OK] Code already works! No fix needed.",1);
            m_isGenerating=false; m_buildStatus="Ready"; return;
        }
        std::string cur=code;
        for(int i=1;i<=10;++i){
            appendOutput("[FIX] Attempt "+std::to_string(i)+"/10 …",0);
            std::string fixed=m_ai->fixCode(cur,r.errorOutput.empty()?r.output:r.errorOutput,lang);
            if(fixed.empty()) break;
            cur=fixed; r=m_executor->execute(cur,lang);
            if(r.success){
                std::lock_guard<std::mutex> lk(m_outputMutex);
                strncpy(m_codeBuf,cur.c_str(),CODE_BUF-1);
                m_output.push_back({"[OK] Fixed in "+std::to_string(i)+" attempt(s)!",1});
                m_scrollOutput=true; m_buildStatus="Fixed!"; m_isGenerating=false; return;
            }
        }
        appendOutput("[ERR] Could not fully fix after 10 attempts.",2);
        m_buildStatus="Fix failed"; m_isGenerating=false;
    }).detach();
}

// ─────────────────────────────────────────────────────────────────────────────
std::string EditorUI::detectLang(const std::string& fn) {
    auto ends=[&](const char* s){
        size_t sl=strlen(s);
        return fn.size()>=sl && fn.substr(fn.size()-sl)==s;
    };
    if(ends(".cpp")||ends(".h"))  return "C++";
    if(ends(".py"))               return "Python";
    if(ends(".js"))               return "JavaScript";
    if(ends(".ts"))               return "TypeScript";
    if(ends(".java"))             return "Java";
    if(ends(".rs"))               return "Rust";
    if(ends(".go"))               return "Go";
    if(ends(".cs"))               return "C#";
    if(ends(".sh"))               return "Bash";
    return "C++";
}

// ═════════════════════════════════════════════════════════════════════════════
//  W E L C O M E   S C R E E N   (Android Studio inspired)
// ═════════════════════════════════════════════════════════════════════════════
void EditorUI::renderWelcomeScreen() {
    ImGuiViewport* vp = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(vp->WorkPos);
    ImGui::SetNextWindowSize(vp->WorkSize);
    ImGui::SetNextWindowViewport(vp->ID);

    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding,   0);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,    {0,0});
    ImGui::Begin("##welcome", nullptr,
        ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoNav);
    ImGui::PopStyleVar(3);

    const float W   = vp->WorkSize.x;
    const float H   = vp->WorkSize.y;
    const float SBW = 290.0f;   // sidebar width

    // ━━━ LEFT SIDEBAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.093f,0.097f,0.110f,1));
    ImGui::PushStyleVar (ImGuiStyleVar_WindowPadding, {0,0});
    ImGui::BeginChild("##sb", {SBW,H}, false, ImGuiWindowFlags_NoScrollbar);
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();

    ImDrawList* sdl = ImGui::GetWindowDrawList();
    ImVec2      swp = ImGui::GetWindowPos();

    // Logo
    const float LSZ = 88.0f;
    float lx = (SBW - LSZ) * 0.5f;
    float ly = 30.0f;
    ImGui::SetCursorPos({lx, ly});
    if (m_logoTexture) {
        ImGui::Image((ImTextureID)(uintptr_t)m_logoTexture, {LSZ, LSZ});
    } else {
        // Fallback: concentric circles with whale initials
        ImVec2 cen = {swp.x + SBW*0.5f, swp.y + ly + LSZ*0.5f};
        sdl->AddCircleFilled(cen, LSZ*0.5f,   IM_COL32(16,40,74,255));
        sdl->AddCircle      (cen, LSZ*0.5f-1, COL_ACCENT, 64, 1.5f);
        sdl->AddCircleFilled(cen, LSZ*0.3f,   IM_COL32(255,107,0,200));
        ImVec2 tsz = ImGui::CalcTextSize("WW");
        sdl->AddText({cen.x-tsz.x*0.5f, cen.y-tsz.y*0.5f},
                     IM_COL32(255,255,255,255), "WW");
        ImGui::Dummy({LSZ, LSZ});
    }

    // IDE name
    ImGui::Spacing();
    {
        const char* nm = "whyWhale IDE";
        float tw = ImGui::CalcTextSize(nm).x;
        ImGui::SetCursorPosX((SBW - tw) * 0.5f);
        ImGui::PushStyleColor(ImGuiCol_Text, {0.94f,0.95f,0.98f,1});
        ImGui::TextUnformatted(nm);
        ImGui::PopStyleColor();
    }
    {
        const char* sb = "AI-Powered Development";
        float tw = ImGui::CalcTextSize(sb).x;
        ImGui::SetCursorPosX((SBW - tw) * 0.5f);
        ImGui::PushStyleColor(ImGuiCol_Text, {0.40f,0.42f,0.48f,1});
        ImGui::TextUnformatted(sb);
        ImGui::PopStyleColor();
    }

    // Divider
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 14);
    ImGui::PushStyleColor(ImGuiCol_Separator, {0.20f,0.21f,0.24f,1});
    ImGui::Separator();
    ImGui::PopStyleColor();

    // Recent header
    ImGui::SetCursorPosX(16);
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 8);
    ImGui::PushStyleColor(ImGuiCol_Text, {0.38f,0.40f,0.46f,1});
    ImGui::TextUnformatted("RECENT PROJECTS");
    ImGui::PopStyleColor();
    ImGui::Spacing();

    // Recent project entries
    struct RP { const char* name; const char* path; const char* lang; };
    static const RP rp[]={
        {"whyWhale",   "C:\\Projects\\whyWhale",    "C++"   },
        {"my_app",     "C:\\Projects\\my_app",       "Python"},
        {"web_server", "C:\\Projects\\web_server",   "Go"    },
    };
    for (auto& r : rp) {
        float sy = ImGui::GetCursorPosY();
        ImGui::SetCursorPosX(0);
        ImGui::PushStyleColor(ImGuiCol_Header,        {0.17f,0.18f,0.21f,1});
        ImGui::PushStyleColor(ImGuiCol_HeaderHovered, {0.21f,0.23f,0.27f,1});
        bool sel = ImGui::Selectable(
            ("##rp_"+std::string(r.name)).c_str(),
            false, 0, {SBW, 48});
        ImGui::PopStyleColor(2);
        if (sel) m_showWelcome = false;

        ImVec2 rmin = {swp.x, swp.y + sy};
        sdl->AddText({rmin.x+16, rmin.y+7},  COL_TXT, r.name);
        sdl->AddText({rmin.x+16, rmin.y+26}, COL_DIM, r.path);
        // Lang badge
        ImVec2 bsz = ImGui::CalcTextSize(r.lang);
        float bx = rmin.x + SBW - bsz.x - 16;
        float by = rmin.y + 14;
        sdl->AddRectFilled({bx-5,by-3}, {bx+bsz.x+5,by+bsz.y+3},
                           IM_COL32(28,72,138,220), 4);
        sdl->AddText({bx,by}, IM_COL32(120,190,255,255), r.lang);
    }

    // Model chip pinned to sidebar bottom
    ImGui::SetCursorPos({0, H-34});
    ImGui::PushStyleColor(ImGuiCol_ChildBg, {0.05f,0.27f,0.63f,1});
    ImGui::BeginChild("##sbmodel",{SBW,34},false,ImGuiWindowFlags_NoScrollbar);
    ImGui::SetCursorPos({10,9});
    ImGui::PushStyleColor(ImGuiCol_Text,{0.78f,0.90f,1.0f,1});
    ImGui::TextUnformatted((" " + m_model).c_str());
    ImGui::PopStyleColor();
    ImGui::EndChild();
    ImGui::PopStyleColor();

    ImGui::EndChild(); // sidebar

    // ━━━ RIGHT PANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ImGui::SameLine(0,0);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, {0.078f,0.082f,0.094f,1});
    ImGui::BeginChild("##rp2",{W-SBW,H},false,ImGuiWindowFlags_NoScrollbar);
    ImGui::PopStyleColor();

    ImDrawList* rdl = ImGui::GetWindowDrawList();
    ImVec2      rwp = ImGui::GetWindowPos();
    float PW = W - SBW;

    // Subtle dot grid background
    for (float gx=20; gx<PW; gx+=44)
        for (float gy=20; gy<H; gy+=44)
            rdl->AddCircleFilled({rwp.x+gx,rwp.y+gy}, 1.2f, IM_COL32(255,255,255,14));

    // ── Heading ──────────────────────────────────────────────────────────────
    {
        // Glow band
        rdl->AddRectFilledMultiColor(
            {rwp.x,      rwp.y + H*0.10f},
            {rwp.x + PW, rwp.y + H*0.10f + 80},
            IM_COL32(79,195,247,0), IM_COL32(79,195,247,0),
            IM_COL32(79,195,247,10),IM_COL32(79,195,247,10));

        const char* t1 = "Welcome to whyWhale";
        const char* t2 = "Build anything  •  Fix everything  •  Powered by Ollama";
        float t1w = ImGui::CalcTextSize(t1).x;
        float t2w = ImGui::CalcTextSize(t2).x;

        ImGui::SetCursorPos({(PW-t1w)*0.5f, H*0.13f});
        ImGui::PushStyleColor(ImGuiCol_Text,{0.95f,0.96f,0.98f,1});
        ImGui::TextUnformatted(t1);
        ImGui::PopStyleColor();

        ImGui::SetCursorPos({(PW-t2w)*0.5f, H*0.13f + 28});
        ImGui::PushStyleColor(ImGuiCol_Text,{0.38f,0.40f,0.46f,1});
        ImGui::TextUnformatted(t2);
        ImGui::PopStyleColor();
    }

    // ── Action cards ─────────────────────────────────────────────────────────
    const float CW    = 215, CH = 134;
    const float GAP   = 32;
    const float TOTAL = CW*2 + GAP;
    const float OX    = (PW - TOTAL) * 0.5f;
    const float OY    = H * 0.34f;

    auto card=[&](float ox, float oy, const char* id,
                  ImU32 acCol, const char* ico,
                  const char* label, const char* desc) -> bool {
        ImGui::SetCursorPos({ox,oy});
        ImGui::InvisibleButton(id,{CW,CH});
        bool hov=ImGui::IsItemHovered();
        bool clk=ImGui::IsItemClicked();

        ImVec2 tl={rwp.x+ox, rwp.y+oy};
        ImVec2 br={tl.x+CW,  tl.y+CH };

        ImU32 bg  = hov ? IM_COL32(48,52,64,255) : IM_COL32(26,28,34,255);
        ImU32 bdr = hov ? acCol : COL_BORDER;
        rdl->AddRectFilled(tl, br, bg, 12);
        rdl->AddRect      (tl, br, bdr, 12, 0, hov?2.0f:1.0f);
        if (hov) rdl->AddRectFilled(tl,{br.x,tl.y+3},acCol,12,ImDrawFlags_RoundCornersTop);

        // Icon circle
        ImVec2 ic={tl.x+CW*0.5f, tl.y+42};
        rdl->AddCircleFilled(ic, 22, hov?(acCol&0x00FFFFFF)|0x3A000000:IM_COL32(36,40,50,255));
        rdl->AddCircle(ic,22,hov?acCol:IM_COL32(60,65,75,255),32,1.5f);
        ImVec2 isz=ImGui::CalcTextSize(ico);
        rdl->AddText({ic.x-isz.x*0.5f,ic.y-isz.y*0.5f},
                     hov?acCol:IM_COL32(148,158,175,255), ico);

        // Labels
        ImVec2 lsz=ImGui::CalcTextSize(label);
        rdl->AddText({tl.x+(CW-lsz.x)*0.5f, tl.y+75}, COL_TXT, label);
        ImVec2 dsz=ImGui::CalcTextSize(desc);
        rdl->AddText({tl.x+(CW-dsz.x)*0.5f, tl.y+96}, COL_DIM, desc);

        return clk;
    };

    if (card(OX,        OY,"##np", COL_ACCENT, "+",
             "New Project",  "Start from scratch")) {
        memset(m_codeBuf,0,CODE_BUF);
        m_tabs.clear();
        m_tabs.push_back({"main.cpp","C++",false});
        m_activeTab=0; m_language="C++";
        m_showWelcome=false;
    }
    if (card(OX+CW+GAP, OY,"##of", COL_ORANGE, ">",
             "Open Folder",  "Browse filesystem")) {
        m_showWelcome=false;
    }

    // Keyboard hint
    {
        const char* hint = "or press  Enter / Space / Esc  to open the IDE directly";
        float hw = ImGui::CalcTextSize(hint).x;
        float dy = OY + CH + 28;
        // Thin horizontal rule
        rdl->AddLine({rwp.x+PW*0.15f, rwp.y+dy-8},
                     {rwp.x+PW*0.85f, rwp.y+dy-8},
                     IM_COL32(46,50,58,255));
        ImGui::SetCursorPos({(PW-hw)*0.5f, dy});
        ImGui::PushStyleColor(ImGuiCol_Text,{0.26f,0.28f,0.32f,1});
        ImGui::TextUnformatted(hint);
        ImGui::PopStyleColor();
    }

    // Any key to skip
    if (ImGui::IsKeyPressed(ImGuiKey_Escape)||
        ImGui::IsKeyPressed(ImGuiKey_Enter) ||
        ImGui::IsKeyPressed(ImGuiKey_Space))
        m_showWelcome=false;

    // Footer
    {
        const char* ft = "whyWhale IDE v1.0   |   OpenGL + Dear ImGui   |   Ollama Backend";
        float fw = ImGui::CalcTextSize(ft).x;
        ImGui::SetCursorPos({(PW-fw)*0.5f, H-24});
        ImGui::PushStyleColor(ImGuiCol_Text,{0.20f,0.22f,0.26f,1});
        ImGui::TextUnformatted(ft);
        ImGui::PopStyleColor();
    }

    ImGui::EndChild();
    ImGui::End();
}

// ═════════════════════════════════════════════════════════════════════════════
//  M E N U   B A R
// ═════════════════════════════════════════════════════════════════════════════
void EditorUI::renderMenuBar() {
    if (!ImGui::BeginMenuBar()) return;

    if (ImGui::BeginMenu("File")) {
        if (ImGui::MenuItem("New File",  "Ctrl+N"))   memset(m_codeBuf,0,CODE_BUF);
        if (ImGui::MenuItem("Save",      "Ctrl+S"))   {}
        ImGui::Separator();
        if (ImGui::MenuItem("Welcome Screen"))         { m_showWelcome=true; m_dockInit=false; }
        ImGui::Separator();
        if (ImGui::MenuItem("Exit",      "Alt+F4"))   {}
        ImGui::EndMenu();
    }
    if (ImGui::BeginMenu("Edit")) {
        if (ImGui::MenuItem("Clear Editor"))
            memset(m_codeBuf,0,CODE_BUF);
        if (ImGui::MenuItem("Clear Output")){
            std::lock_guard<std::mutex> lk(m_outputMutex);
            m_output.clear();
        }
        ImGui::EndMenu();
    }
    if (ImGui::BeginMenu("View")) {
        ImGui::MenuItem("File Tree");
        ImGui::MenuItem("AI Panel");
        ImGui::MenuItem("Output");
        ImGui::EndMenu();
    }
    if (ImGui::BeginMenu("Build")) {
        if (ImGui::MenuItem("Run",      "Shift+F10")) doRun();
        if (ImGui::MenuItem("Auto Fix", "Shift+F9"))  doFix();
        ImGui::EndMenu();
    }
    if (ImGui::BeginMenu("Tools")) {
        if (ImGui::BeginMenu("Select Language")) {
            static const char* ls[]={"Python","C++","C","JavaScript","Java","Rust","Go","TypeScript","C#","Bash"};
            for(auto& l:ls) if(ImGui::MenuItem(l)) m_language=l;
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Change Model")) {
            static char mb[128]={};
            ImGui::InputText("##model",mb,128);
            if(ImGui::Button("Apply")&&mb[0]){m_model=mb;m_ai->setModel(mb);}
            ImGui::EndMenu();
        }
        ImGui::EndMenu();
    }
    if (ImGui::BeginMenu("Help")) {
        ImGui::TextColored(C_ACCENT,"whyWhale IDE v1.0");
        ImGui::TextDisabled("Powered by Ollama + Dear ImGui");
        ImGui::Separator();
        ImGui::Text("Model: %s",m_model.c_str());
        ImGui::EndMenu();
    }
    ImGui::EndMenuBar();
}

// ═════════════════════════════════════════════════════════════════════════════
//  T O O L B A R
// ═════════════════════════════════════════════════════════════════════════════
void EditorUI::renderToolbar() {
    ImGui::PushStyleColor(ImGuiCol_ChildBg,{0.093f,0.097f,0.110f,1});
    ImGui::BeginChild("##tb",{0,40},false,ImGuiWindowFlags_NoScrollbar);
    ImGui::SetCursorPosY(6);

    ImGui::PushStyleColor(ImGuiCol_Button,{0.18f,0.20f,0.24f,1});
    if (ImGui::Button("  New  "))  memset(m_codeBuf,0,CODE_BUF);
    ImGui::SameLine(0,4);
    ImGui::Button("  Save  ");
    ImGui::PopStyleColor();
    ImGui::SameLine(0,14);

    ImGui::PushStyleColor(ImGuiCol_Separator,{0.24f,0.25f,0.28f,1});
    ImGui::SeparatorEx(ImGuiSeparatorFlags_Vertical);
    ImGui::PopStyleColor();
    ImGui::SameLine(0,14);

    // Run
    ImGui::PushStyleColor(ImGuiCol_Button,        {0.12f,0.36f,0.13f,1});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.15f,0.46f,0.16f,1});
    if (ImGui::Button("  Run  ")&&!m_isRunning.load()) doRun();
    ImGui::PopStyleColor(2);
    ImGui::SameLine(0,4);

    // Debug
    ImGui::PushStyleColor(ImGuiCol_Button,        {0.10f,0.30f,0.52f,1});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.12f,0.38f,0.64f,1});
    ImGui::Button("  Debug  ");
    ImGui::PopStyleColor(2);
    ImGui::SameLine(0,4);

    // Stop
    ImGui::PushStyleColor(ImGuiCol_Button,        {0.46f,0.12f,0.12f,1});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.58f,0.15f,0.15f,1});
    ImGui::Button("  Stop  ");
    ImGui::PopStyleColor(2);
    ImGui::SameLine(0,14);

    ImGui::PushStyleColor(ImGuiCol_Separator,{0.24f,0.25f,0.28f,1});
    ImGui::SeparatorEx(ImGuiSeparatorFlags_Vertical);
    ImGui::PopStyleColor();
    ImGui::SameLine(0,14);

    // Auto Fix
    ImGui::PushStyleColor(ImGuiCol_Button,        {0.31f,0.765f,0.969f,0.14f});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.31f,0.765f,0.969f,0.28f});
    ImGui::PushStyleColor(ImGuiCol_Text,          (ImVec4)C_ACCENT);
    if (ImGui::Button("  Auto Fix  ")&&!m_isGenerating.load()) doFix();
    ImGui::PopStyleColor(3);
    ImGui::SameLine(0,14);

    // Model label
    ImGui::PushStyleColor(ImGuiCol_Text,(ImVec4)C_DIM);
    ImGui::SetCursorPosY(12);
    ImGui::TextUnformatted(("Model: "+m_model).c_str());
    ImGui::PopStyleColor();

    // Working spinner
    if (m_isGenerating.load()||m_isRunning.load()) {
        ImGui::SameLine(0,10);
        float t=(float)ImGui::GetTime();
        static const char* fr[]{"|","/","-","\\"};
        ImGui::PushStyleColor(ImGuiCol_Text,(ImVec4)C_ORANGE);
        ImGui::Text(" %s Working…",fr[(int)(t*6)%4]);
        ImGui::PopStyleColor();
    }

    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::Separator();
}

// ═════════════════════════════════════════════════════════════════════════════
//  F I L E   T R E E
// ═════════════════════════════════════════════════════════════════════════════
void EditorUI::renderFileTree() {
    ImGui::SetNextWindowSize({240,600},ImGuiCond_FirstUseEver);
    ImGui::Begin("Project");

    static char search[64]={};
    ImGui::SetNextItemWidth(-1);
    ImGui::PushStyleColor(ImGuiCol_FrameBg,{0.11f,0.12f,0.14f,1});
    ImGui::InputTextWithHint("##search","  Search files…",search,64);
    ImGui::PopStyleColor();
    ImGui::Spacing();

    auto fileNode=[&](const char* icon,const char* name,const char* lang,ImVec4 icol){
        if(search[0]&&!strstr(name,search)) return;
        ImGui::PushStyleColor(ImGuiCol_Text,icol);
        ImGui::TextUnformatted(icon);
        ImGui::PopStyleColor();
        ImGui::SameLine(0,7);
        if (ImGui::Selectable(name,false,0,{0,0})) {
            bool found=false;
            for(int i=0;i<(int)m_tabs.size();++i)
                if(m_tabs[i].name==name){m_activeTab=i;found=true;break;}
            if(!found){m_tabs.push_back({name,lang,false});m_activeTab=(int)m_tabs.size()-1;}
            m_language=lang;
        }
    };

    ImGui::PushStyleColor(ImGuiCol_Text,(ImVec4)C_YELLOW);
    bool root=ImGui::TreeNodeEx("whyWhale",ImGuiTreeNodeFlags_DefaultOpen);
    ImGui::PopStyleColor();
    if(root){
        ImGui::PushStyleColor(ImGuiCol_Text,(ImVec4)C_DIM);
        m_srcOpen=ImGui::TreeNodeEx("src",ImGuiTreeNodeFlags_DefaultOpen);
        ImGui::PopStyleColor();
        if(m_srcOpen){
            fileNode("[cpp]","ai_engine.cpp",     "C++",(ImVec4)C_ACCENT);
            fileNode("[cpp]","code_executor.cpp",  "C++",(ImVec4)C_ACCENT);
            fileNode("[cpp]","editor_ui.cpp",      "C++",(ImVec4)C_ACCENT);
            fileNode("[cpp]","error_fixer.cpp",    "C++",(ImVec4)C_ACCENT);
            fileNode("[cpp]","ollama_manager.cpp", "C++",(ImVec4)C_ACCENT);
            ImGui::TreePop();
        }
        ImGui::PushStyleColor(ImGuiCol_Text,(ImVec4)C_DIM);
        m_incOpen=ImGui::TreeNodeEx("include",ImGuiTreeNodeFlags_DefaultOpen);
        ImGui::PopStyleColor();
        if(m_incOpen){
            fileNode("[ h ]","ai_engine.h",      "C++",(ImVec4)C_PURPLE);
            fileNode("[ h ]","code_executor.h",  "C++",(ImVec4)C_PURPLE);
            fileNode("[ h ]","editor_ui.h",      "C++",(ImVec4)C_PURPLE);
            fileNode("[ h ]","error_fixer.h",    "C++",(ImVec4)C_PURPLE);
            fileNode("[ h ]","ollama_manager.h", "C++",(ImVec4)C_PURPLE);
            ImGui::TreePop();
        }
        fileNode("[cpp]","main.cpp",         "C++",  (ImVec4)C_ACCENT);
        fileNode("[cmake]","CMakeLists.txt", "CMake",(ImVec4)C_GREEN);
        ImGui::TreePop();
    }
    ImGui::End();
}

// ═════════════════════════════════════════════════════════════════════════════
//  C O D E   E D I T O R
// ═════════════════════════════════════════════════════════════════════════════
void EditorUI::renderCodeEditor() {
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,{0,0});
    ImGui::Begin("Code Editor");
    ImGui::PopStyleVar();

    // Task row
    ImGui::PushStyleColor(ImGuiCol_ChildBg,{0.093f,0.097f,0.110f,1});
    ImGui::BeginChild("##taskrow",{0,58},false);
    ImGui::SetCursorPos({10,12});
    ImGui::TextColored(C_ORANGE,"Task:");
    ImGui::SameLine(0,8);
    ImGui::SetNextItemWidth(-248);
    ImGui::PushStyleColor(ImGuiCol_FrameBg,{0.11f,0.12f,0.14f,1});
    ImGui::InputTextWithHint("##task",
        "Describe what to build (e.g. 'fibonacci generator')…",
        m_taskBuf,1024);
    ImGui::PopStyleColor();
    ImGui::SameLine(0,8);
    ImGui::SetNextItemWidth(120);
    ImGui::PushStyleColor(ImGuiCol_FrameBg,{0.11f,0.12f,0.14f,1});
    if(ImGui::BeginCombo("##lang",m_language.c_str())){
        static const char* ls[]={"Python","C++","C","JavaScript","Java","Rust","Go","TypeScript","C#","Bash"};
        for(auto& l:ls) if(ImGui::Selectable(l,m_language==l)) m_language=l;
        ImGui::EndCombo();
    }
    ImGui::PopStyleColor();
    ImGui::SameLine(0,8);
    bool busy=m_isGenerating.load()||m_isRunning.load();
    ImGui::PushStyleColor(ImGuiCol_Button,        {0.12f,0.36f,0.13f,1});
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.15f,0.46f,0.16f,1});
    if(busy) ImGui::BeginDisabled();
    if(ImGui::Button("Generate",{94,0})&&m_taskBuf[0])
        doGenerate(std::string(m_taskBuf),m_language);
    if(busy) ImGui::EndDisabled();
    ImGui::PopStyleColor(2);
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::Separator();

    // File tabs
    if(!m_tabs.empty()){
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,{2,0});
        for(int i=0;i<(int)m_tabs.size();++i){
            if(i>0) ImGui::SameLine(0,2);
            std::string lbl=m_tabs[i].name+(m_tabs[i].modified?" *":"")+"##t"+std::to_string(i);
            ImGui::PushStyleColor(ImGuiCol_Button,
                i==m_activeTab?ImVec4(0.078f,0.082f,0.094f,1):ImVec4(0.115f,0.120f,0.136f,1));
            ImGui::PushStyleColor(ImGuiCol_Text,
                i==m_activeTab?(ImVec4)C_ACCENT:(ImVec4)C_DIM);
            if(ImGui::SmallButton(lbl.c_str())) m_activeTab=i;
            ImGui::PopStyleColor(2);
        }
        ImGui::PopStyleVar();
        ImGui::Separator();
    }

    // Gutter + editor
    float gW=58, eH=ImGui::GetContentRegionAvail().y;
    ImGui::PushStyleColor(ImGuiCol_ChildBg,{0.060f,0.063f,0.072f,1});
    ImGui::BeginChild("##gutter",{gW,eH},false,
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PushStyleColor(ImGuiCol_Text,{0.28f,0.30f,0.36f,1});
    ImGui::SetCursorPosY(ImGui::GetCursorPosY()+4);
    int lines=1;
    for(const char* p=m_codeBuf;*p;++p) if(*p=='\n') ++lines;
    for(int i=1;i<=lines;++i){
        char b[8]; snprintf(b,8,"%4d",i);
        ImGui::TextUnformatted(b);
    }
    ImGui::PopStyleColor();
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::SameLine(0,0);

    // Code input — PushFont + PopFont ALWAYS balanced (fixes "Missing PopFont" crash)
    ImGui::PushStyleColor(ImGuiCol_FrameBg,    {0.068f,0.072f,0.082f,1});
    ImGui::PushStyleColor(ImGuiCol_ScrollbarBg,(ImVec4)C_BG0);
    ImGui::PushFont(ImGui::GetIO().Fonts->Fonts.Size>1
                    ? ImGui::GetIO().Fonts->Fonts[1] : nullptr);

    ImGui::InputTextMultiline("##code",m_codeBuf,CODE_BUF,
        {-1,eH},ImGuiInputTextFlags_AllowTabInput);

    ImGui::PopFont();           // always unconditional — never skip this
    ImGui::PopStyleColor(2);

    ImGui::End();
}

// ═════════════════════════════════════════════════════════════════════════════
//  A I   P A N E L
// ═════════════════════════════════════════════════════════════════════════════
void EditorUI::renderAIPanel() {
    ImGui::Begin("AI Assistant");

    bool live = !m_isGenerating.load()&&!m_isRunning.load();
    ImGui::PushStyleColor(ImGuiCol_ChildBg,
        live?ImVec4(0.05f,0.20f,0.09f,1):ImVec4(0.28f,0.14f,0.02f,1));
    ImGui::BeginChild("##chip",{0,30},false);
    ImGui::SetCursorPos({10,7});
    ImGui::PushStyleColor(ImGuiCol_Text,
        live?(ImVec4)C_GREEN:(ImVec4)C_ORANGE);
    { std::string _chip = std::string(live?"  Ready  |  ":"  Busy   |  ")+m_model;
      ImGui::TextUnformatted(_chip.c_str()); }
    ImGui::PopStyleColor();
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::Spacing();

    if(ImGui::BeginTabBar("##aitabs")){
        if(ImGui::BeginTabItem("  AI Chat  "))  {m_aiTab=0;ImGui::EndTabItem();}
        if(ImGui::BeginTabItem(" Structure "))  {m_aiTab=1;ImGui::EndTabItem();}
        ImGui::EndTabBar();
    }

    if(m_aiTab==0){
        float inputH=78, chatH=ImGui::GetContentRegionAvail().y-inputH-16;
        ImGui::PushStyleColor(ImGuiCol_ChildBg,(ImVec4)C_BG1);
        ImGui::BeginChild("##chat",{0,chatH},false);

        for(auto& msg:m_chat){
            ImGui::Spacing();
            if(msg.isUser){
                ImGui::Indent(14);
                ImGui::PushStyleColor(ImGuiCol_ChildBg,{0.14f,0.28f,0.50f,1});
                float av=ImGui::GetContentRegionAvail().x-14;
                std::string cid="##u"+msg.text.substr(0,std::min((int)msg.text.size(),8));
                ImGui::BeginChild(cid.c_str(),{av,0},true);
                ImGui::PushStyleColor(ImGuiCol_Text,(ImVec4)C_ACCENT);
                ImGui::TextUnformatted("You");
                ImGui::PopStyleColor();
                ImGui::TextWrapped("%s",msg.text.c_str());
                ImGui::EndChild();
                ImGui::PopStyleColor();
                ImGui::Unindent(14);
            } else {
                ImGui::PushStyleColor(ImGuiCol_ChildBg,(ImVec4)C_BG2);
                float av=ImGui::GetContentRegionAvail().x-14;
                std::string cid="##b"+msg.text.substr(0,std::min((int)msg.text.size(),8));
                ImGui::BeginChild(cid.c_str(),{av,0},true);
                ImGui::PushStyleColor(ImGuiCol_Text,(ImVec4)C_ORANGE);
                ImGui::TextUnformatted("  whyWhale AI");
                ImGui::PopStyleColor();
                ImGui::TextWrapped("%s",msg.text.c_str());
                ImGui::EndChild();
                ImGui::PopStyleColor();
            }
            ImGui::Spacing();
        }
        if(m_scrollChat){ImGui::SetScrollHereY(1.0f);m_scrollChat=false;}
        ImGui::EndChild();
        ImGui::PopStyleColor();
        ImGui::Separator();

        ImGui::SetNextItemWidth(-50);
        bool enter=ImGui::InputTextWithHint("##aiinput",
            "Ask whyWhale anything…",m_aiInputBuf,512,
            ImGuiInputTextFlags_EnterReturnsTrue);
        ImGui::SameLine(0,4);
        ImGui::PushStyleColor(ImGuiCol_Button,        {0.31f,0.765f,0.969f,0.88f});
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, {0.40f,0.820f,1.000f,1.00f});
        ImGui::PushStyleColor(ImGuiCol_Text,           {0,0,0,1});
        bool send=ImGui::Button(" >> ",{42,0});
        ImGui::PopStyleColor(3);

        if((enter||send)&&m_aiInputBuf[0]&&!m_isGenerating.load()){
            std::string q(m_aiInputBuf);
            m_chat.push_back({true,q,false});
            m_scrollChat=true;
            memset(m_aiInputBuf,0,512);
            m_isGenerating=true;
            std::thread([this,q](){
                std::string r=m_ai->prompt(
                    "You are whyWhale, a helpful coding assistant. Be concise.",q);
                {std::lock_guard<std::mutex> lk(m_outputMutex);
                 m_chat.push_back({false,r.empty()?"(no response)":r,false});
                 m_scrollChat=true;}
                m_isGenerating=false;
            }).detach();
        }
    } else {
        ImGui::BeginChild("##struct",{0,0},false);
        if(ImGui::TreeNodeEx("Classes",ImGuiTreeNodeFlags_DefaultOpen)){
            ImGui::TextColored(C_TEAL,"  AIEngine");
            ImGui::TextColored(C_TEAL,"  CodeExecutor");
            ImGui::TextColored(C_TEAL,"  ErrorFixer");
            ImGui::TextColored(C_TEAL,"  EditorUI");
            ImGui::TextColored(C_TEAL,"  OllamaManager");
            ImGui::TreePop();
        }
        if(ImGui::TreeNodeEx("Functions",ImGuiTreeNodeFlags_DefaultOpen)){
            ImGui::TextColored(C_FN,"  generateCode()");
            ImGui::TextColored(C_FN,"  fixCode()");
            ImGui::TextColored(C_FN,"  execute()");
            ImGui::TextColored(C_FN,"  pullModel()");
            ImGui::TextColored(C_FN,"  isServerRunning()");
            ImGui::TreePop();
        }
        ImGui::EndChild();
    }
    ImGui::End();
}

// ═════════════════════════════════════════════════════════════════════════════
//  O U T P U T   P A N E L
// ═════════════════════════════════════════════════════════════════════════════
void EditorUI::renderOutputPanel() {
    ImGui::Begin("Output");
    if(ImGui::BeginTabBar("##btabs")){
        if(ImGui::BeginTabItem("  Run  "))      {m_bottomTab=0;ImGui::EndTabItem();}
        if(ImGui::BeginTabItem("  Build  "))    {m_bottomTab=1;ImGui::EndTabItem();}
        if(ImGui::BeginTabItem("  Problems  ")) {m_bottomTab=2;ImGui::EndTabItem();}
        if(ImGui::BeginTabItem("  Fix Log  "))  {m_bottomTab=3;ImGui::EndTabItem();}
        ImGui::EndTabBar();
    }
    static const ImVec4 tc[]={
        {0.31f,0.765f,0.969f,1},
        {0.41f,0.94f,0.68f,1},
        {1.0f,0.32f,0.32f,1},
        {1.0f,0.42f,0.00f,1},
        {0.38f,0.40f,0.45f,1}
    };
    ImGui::PushStyleColor(ImGuiCol_ChildBg,{0.042f,0.044f,0.052f,1});
    ImGui::BeginChild("##outlog",{0,0},false);
    {
        std::lock_guard<std::mutex> lk(m_outputMutex);
        for(auto& ln:m_output){
            int t=std::max(0,std::min(4,ln.type));
            ImGui::PushStyleColor(ImGuiCol_Text,tc[t]);
            ImGui::TextUnformatted(ln.text.c_str());
            ImGui::PopStyleColor();
        }
        if(m_scrollOutput){ImGui::SetScrollHereY(1.0f);m_scrollOutput=false;}
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::End();
}

// ═════════════════════════════════════════════════════════════════════════════
//  S T A T U S   B A R
// ═════════════════════════════════════════════════════════════════════════════
void EditorUI::renderStatusBar() {
    ImGuiViewport* vp=ImGui::GetMainViewport();
    ImGui::SetNextWindowPos ({vp->Pos.x, vp->Pos.y+vp->Size.y-24});
    ImGui::SetNextWindowSize({vp->Size.x, 24});
    ImGui::SetNextWindowViewport(vp->ID);
    ImGuiWindowFlags sbf =
        ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoResize|
        ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoSavedSettings|
        ImGuiWindowFlags_NoDocking|ImGuiWindowFlags_NoMove;
    ImGui::PushStyleColor(ImGuiCol_WindowBg,{0.05f,0.27f,0.63f,1});
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding,  0);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize,0);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,   {10,4});
    ImGui::Begin("##sb2",nullptr,sbf);
    ImGui::PushStyleColor(ImGuiCol_Text,{0.78f,0.90f,1.0f,1});
    ImGui::Text(" %s",m_model.c_str());
    ImGui::SameLine(0,20);
    ImGui::TextUnformatted(" main");
    ImGui::SameLine(0,20);
    ImGui::Text(" %s",m_language.c_str());
    float rw=320;
    ImGui::SameLine(ImGui::GetWindowWidth()-rw);
    ImGui::TextUnformatted(m_buildStatus.c_str());
    ImGui::SameLine(0,18);
    ImGui::TextUnformatted("UTF-8");
    ImGui::SameLine(0,18);
    char cur[32]; snprintf(cur,32,"Ln %d  Col %d",m_cursorLine,m_cursorCol);
    ImGui::TextUnformatted(cur);
    ImGui::PopStyleColor();
    ImGui::End();
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(3);
}

// ═════════════════════════════════════════════════════════════════════════════
//  M A I N   R U N   L O O P
// ═════════════════════════════════════════════════════════════════════════════
void EditorUI::run(const std::string& model) {
    m_model=model;

    OllamaManager ollama;
    AIEngine      ai(model);
    CodeExecutor  executor;
    m_ai=&ai; m_executor=&executor; m_ollama=&ollama;

    m_tabs={
        {"ollama_manager.cpp","C++",false},
        {"ai_engine.cpp",     "C++",false},
        {"main.cpp",          "C++",false}
    };
    m_chat.push_back({false,
        "Hello! I'm whyWhale AI.\n\n"
        "  • Describe a task above and click Generate\n"
        "  • Click Run to execute code\n"
        "  • Click Auto Fix to self-heal errors\n"
        "  • Ask me anything in this chat",false});
    appendOutput("[whyWhale] IDE ready. Model: "+model,1);
    appendOutput("[whyWhale] Type a task above and click Generate!",0);

    // ── GLFW ─────────────────────────────────────────────────────────────────
    if(!glfwInit()){std::cerr<<"[whyWhale] GLFW init failed\n";return;}
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR,3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR,3);
    glfwWindowHint(GLFW_OPENGL_PROFILE,GLFW_OPENGL_CORE_PROFILE);
#ifdef __APPLE__
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT,GL_TRUE);
#endif
    GLFWwindow* win=glfwCreateWindow(1440,900,"whyWhale IDE",nullptr,nullptr);
    if(!win){glfwTerminate();return;}
    glfwMakeContextCurrent(win);
    glfwSwapInterval(1);

    // ── ImGui ─────────────────────────────────────────────────────────────────
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io=ImGui::GetIO();
    io.ConfigFlags|=ImGuiConfigFlags_DockingEnable;
    io.ConfigFlags|=ImGuiConfigFlags_ViewportsEnable;
    io.IniFilename="whywhale_layout.ini";

    // Fonts — two slots at 16 px (bigger and more readable than the 13 px default)
    for(int i=0;i<2;++i){
        ImFontConfig fc;
        fc.SizePixels=16.0f; fc.OversampleH=2; fc.OversampleV=2;
        io.Fonts->AddFontDefault(&fc);
    }

    applyTheme();
    ImGui_ImplGlfw_InitForOpenGL(win,true);
    ImGui_ImplOpenGL3_Init("#version 330");

    // ── Logo texture (try several paths) ─────────────────────────────────────
    const char* logoPaths[]={"logo.png","assets/logo.png","resources/logo.png",nullptr};
    for(int i=0;logoPaths[i];++i){loadLogoTexture(logoPaths[i]);if(m_logoTexture) break;}

    // ── Main loop ─────────────────────────────────────────────────────────────
    while(!glfwWindowShouldClose(win)){
        glfwPollEvents();
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        if(m_showWelcome){
            renderWelcomeScreen();
        } else {
            ImGuiViewport* vp=ImGui::GetMainViewport();
            ImGui::SetNextWindowPos (vp->WorkPos);
            ImGui::SetNextWindowSize({vp->WorkSize.x, vp->WorkSize.y-24});
            ImGui::SetNextWindowViewport(vp->ID);
            ImGuiWindowFlags hf=
                ImGuiWindowFlags_NoTitleBar|ImGuiWindowFlags_NoCollapse|
                ImGuiWindowFlags_NoResize  |ImGuiWindowFlags_NoMove    |
                ImGuiWindowFlags_NoBringToFrontOnFocus|ImGuiWindowFlags_NoNavFocus|
                ImGuiWindowFlags_MenuBar   |ImGuiWindowFlags_NoDocking;
            ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding,  0);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize,0);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,   {0,0});
            ImGui::Begin("##Host",nullptr,hf);
            ImGui::PopStyleVar(3);

            renderMenuBar();
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,{8,0});
            renderToolbar();
            ImGui::PopStyleVar();

            ImGuiID dsId=ImGui::GetID("MainDock");
            ImGui::DockSpace(dsId,{0,0},ImGuiDockNodeFlags_PassthruCentralNode);
            if(!m_dockInit){
                m_dockInit=true;
                ImGuiViewport* vp2=ImGui::GetMainViewport();
                setupInitialDock(dsId,vp2->WorkSize.x,vp2->WorkSize.y-24);
            }
            ImGui::End();

            renderFileTree();
            renderCodeEditor();
            renderAIPanel();
            renderOutputPanel();
            renderStatusBar();
        }

        // Render
        ImGui::Render();
        int fw,fh; glfwGetFramebufferSize(win,&fw,&fh);
        glViewport(0,0,fw,fh);
        glClearColor(0.078f,0.082f,0.094f,1.0f);
        glClear(GL_COLOR_BUFFER_BIT);
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
        if(io.ConfigFlags&ImGuiConfigFlags_ViewportsEnable){
            GLFWwindow* bk=glfwGetCurrentContext();
            ImGui::UpdatePlatformWindows();
            ImGui::RenderPlatformWindowsDefault();
            glfwMakeContextCurrent(bk);
        }
        glfwSwapBuffers(win);
    }

    if(m_logoTexture) glDeleteTextures(1,&m_logoTexture);
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
    glfwDestroyWindow(win);
    glfwTerminate();
}