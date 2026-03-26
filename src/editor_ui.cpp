#include "editor_ui.h"
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include <limits>

#ifdef _WIN32
#include <windows.h>
// Enable ANSI escape codes on Windows 10+
static void enableANSI() {
    HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD mode = 0;
    GetConsoleMode(h, &mode);
    SetConsoleMode(h, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
}
#else
static void enableANSI() {}
#endif

// ── ANSI Colors ───────────────────────────────────────────────────────────────
#define RESET   "\033[0m"
#define BOLD    "\033[1m"
#define CYAN    "\033[36m"
#define BLUE    "\033[34m"
#define GREEN   "\033[32m"
#define YELLOW  "\033[33m"
#define RED     "\033[31m"
#define MAGENTA "\033[35m"
#define WHITE   "\033[97m"
#define DIM     "\033[2m"

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::separator(char c, int width) {
    std::cout << CYAN;
    for (int i = 0; i < width; i++) std::cout << c;
    std::cout << RESET << "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::showBanner() {
    enableANSI();
    std::cout << "\n" << CYAN;
    std::cout << R"(
  ██╗    ██╗██╗  ██╗██╗   ██╗██╗    ██╗██╗  ██╗ █████╗ ██╗     ███████╗
  ██║    ██║██║  ██║╚██╗ ██╔╝██║    ██║██║  ██║██╔══██╗██║     ██╔════╝
  ██║ █╗ ██║███████║ ╚████╔╝ ██║ █╗ ██║███████║███████║██║     █████╗
  ██║███╗██║██╔══██║  ╚██╔╝  ██║███╗██║██╔══██║██╔══██║██║     ██╔══╝
  ╚███╔███╔╝██║  ██║   ██║   ╚███╔███╔╝██║  ██║██║  ██║███████╗███████╗
   ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝    ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝
)" << RESET;

    std::cout << BOLD << WHITE
              << "         🐋  AI-Powered Code Generator & Self-Healing Editor\n"
              << RESET;
    std::cout << DIM
              << "              Powered by Ollama · Runs Locally · Any Language\n\n"
              << RESET;
    separator('═', 72);
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::printCode(const std::string& code, const std::string& lang) {
    separator('-', 60);
    std::cout << BOLD << YELLOW << "  📄 Generated " << lang << " Code:\n" << RESET;
    separator('-', 60);
    std::cout << GREEN;

    std::istringstream ss(code);
    std::string line;
    int lineNum = 1;
    while (std::getline(ss, line)) {
        std::cout << DIM << "  " << lineNum++ << " \t" << RESET
                  << GREEN << line << "\n";
    }

    std::cout << RESET;
    separator('-', 60);
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::printResult(const ExecutionResult& result) {
    separator('-', 60);
    if (result.success) {
        std::cout << BOLD << GREEN << "  ✅ Execution Successful!\n" << RESET;
        std::cout << "  Output:\n" << YELLOW;
        std::cout << "  " << result.output << RESET;
    } else {
        std::cout << BOLD << RED << "  ❌ Execution Error:\n" << RESET;
        std::cout << RED << result.errorOutput << RESET << "\n";
    }
    separator('-', 60);
}

// ─────────────────────────────────────────────────────────────────────────────
std::string EditorUI::selectLanguage() {
    std::vector<std::string> langs = {
        "Python", "C++", "C", "JavaScript", "Java",
        "Rust", "Go", "TypeScript", "C#", "Bash"
    };

    std::cout << BOLD << CYAN << "\n  🌐 Select Language:\n" << RESET;
    for (int i = 0; i < (int)langs.size(); i++) {
        std::cout << "    [" << (i+1) << "] " << langs[i] << "\n";
    }
    std::cout << "    [0] Type custom language name\n\n";
    std::cout << "  > ";

    int choice;
    std::cin >> choice;
    std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');

    if (choice == 0) {
        std::string custom;
        std::cout << "  Enter language: ";
        std::getline(std::cin, custom);
        return custom;
    }
    if (choice >= 1 && choice <= (int)langs.size())
        return langs[choice - 1];
    return "Python";
}

// ─────────────────────────────────────────────────────────────────────────────
std::string EditorUI::readMultilineInput(const std::string& promptMsg) {
    std::cout << BOLD << MAGENTA << "\n  " << promptMsg << "\n" << RESET;
    std::cout << DIM << "  (Type your text. Enter a line with just 'END' to finish)\n" << RESET;
    std::cout << "  ─────────────────────────────────────────\n";

    std::string result, line;
    while (std::getline(std::cin, line)) {
        if (line == "END") break;
        result += line + "\n";
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::handleNewTask(AIEngine& ai, CodeExecutor& executor, ErrorFixer& fixer) {
    separator('═', 72);
    std::cout << BOLD << WHITE << "  🤖 NEW CODING TASK\n" << RESET;

    // Get task description
    std::cout << BOLD << CYAN << "\n  📝 Describe what you want to build:\n" << RESET;
    std::cout << DIM << "  (Be specific! e.g. 'Create a calculator that adds, subtracts, multiplies, divides')\n" << RESET;
    std::cout << "  > ";
    std::string task;
    std::getline(std::cin, task);

    // Select language
    std::string language = selectLanguage();

    std::cout << BOLD << CYAN << "\n  [🤖 whyWhale is generating your " << language << " code...]\n" << RESET;

    // Generate code
    std::string code = ai.generateCode(task, language);

    if (code.empty()) {
        std::cout << RED << "  [✗ Failed to generate code. Is Ollama running?]\n" << RESET;
        return;
    }

    printCode(code, language);

    // Auto-fix loop
    std::cout << BOLD << CYAN << "\n  [🔁 Running self-healing fix loop...]\n" << RESET;
    FixResult fixResult = fixer.fixUntilClean(code, language, 10);

    if (fixResult.succeeded) {
        std::cout << BOLD << GREEN << "\n  ✅ whyWhale produced working code in "
                  << fixResult.attemptsUsed << " attempt(s)!\n" << RESET;

        if (fixResult.finalCode != code) {
            std::cout << YELLOW << "\n  (Code was auto-fixed. Showing final version:)\n" << RESET;
            printCode(fixResult.finalCode, language);
        }

        std::cout << BOLD << GREEN << "\n  📤 Final Output:\n" << RESET;
        std::cout << YELLOW << "  " << fixResult.finalOutput << RESET << "\n";
    } else {
        std::cout << RED << "\n  ⚠ Could not fully fix after "
                  << fixResult.attemptsUsed << " attempts.\n" << RESET;
        std::cout << "  Last version of code:\n";
        printCode(fixResult.finalCode, language);
    }

    // Ask user if satisfied
    while (true) {
        separator('-', 60);
        std::cout << BOLD << "\n  Are you satisfied with this result?\n" << RESET;
        std::cout << "  [1] ✅ Yes, I'm done\n";
        std::cout << "  [2] 🔄 Modify the task and regenerate\n";
        std::cout << "  [3] 🛠  Ask AI to improve this code\n";
        std::cout << "  > ";

        int choice;
        std::cin >> choice;
        std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');

        if (choice == 1) {
            break;
        } else if (choice == 2) {
            // Let user modify task
            std::cout << CYAN << "  Enter modified task: " << RESET;
            std::getline(std::cin, task);
            code = ai.generateCode(task, language);
            printCode(code, language);
            fixResult = fixer.fixUntilClean(code, language, 10);
            if (fixResult.succeeded) {
                std::cout << GREEN << "\n  ✅ Output:\n  " << fixResult.finalOutput << RESET << "\n";
            }
        } else if (choice == 3) {
            std::cout << CYAN << "  What should be improved? " << RESET;
            std::string improvement;
            std::getline(std::cin, improvement);

            std::string improveTask = "Improve this code: " + improvement +
                                      "\n\nOriginal code:\n" + fixResult.finalCode;
            code = ai.generateCode(improveTask, language);
            printCode(code, language);
            fixResult = fixer.fixUntilClean(code, language, 10);
            if (fixResult.succeeded) {
                std::cout << GREEN << "\n  ✅ Output:\n  " << fixResult.finalOutput << RESET << "\n";
            }
        } else {
            break;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::handleFixCode(AIEngine& ai, CodeExecutor& executor, ErrorFixer& fixer) {
    separator('═', 72);
    std::cout << BOLD << WHITE << "  🛠 FIX MY CODE\n" << RESET;

    std::string language = selectLanguage();
    std::string code = readMultilineInput("Paste your broken code (type END on a new line when done):");

    std::cout << BOLD << CYAN << "\n  [🔁 Running self-healing fix loop...]\n" << RESET;
    FixResult result = fixer.fixUntilClean(code, language, 10);

    if (result.succeeded) {
        std::cout << BOLD << GREEN << "\n  ✅ Fixed in " << result.attemptsUsed << " attempt(s)!\n\n" << RESET;
        printCode(result.finalCode, language);
        std::cout << GREEN << "\n  Output:\n  " << result.finalOutput << RESET << "\n";
    } else {
        std::cout << RED << "\n  ⚠ Could not fully auto-fix. Best attempt shown below:\n" << RESET;
        printCode(result.finalCode, language);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::handleSettings(AIEngine& ai, OllamaManager& ollama) {
    separator('═', 72);
    std::cout << BOLD << WHITE << "  ⚙ SETTINGS\n" << RESET;
    std::cout << "  Current Model: " << YELLOW << ai.getModel() << RESET << "\n\n";
    std::cout << "  [1] Change AI model\n";
    std::cout << "  [2] Pull a new model\n";
    std::cout << "  [3] List available models\n";
    std::cout << "  [4] Back\n";
    std::cout << "  > ";

    int choice;
    std::cin >> choice;
    std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');

    if (choice == 1) {
        std::cout << CYAN << "  Enter model name (e.g. dolphin-llama3, codellama, dolphin-mixtral): " << RESET;
        std::string m;
        std::getline(std::cin, m);
        if (!m.empty()) {
            ai.setModel(m);
            std::cout << GREEN << "  ✓ Model changed to: " << m << RESET << "\n";
        }
    } else if (choice == 2) {
        std::cout << CYAN << "  Enter model name to pull: " << RESET;
        std::string m;
        std::getline(std::cin, m);
        ollama.pullModel(m);
    } else if (choice == 3) {
        std::system("ollama list");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::showHelp() {
    separator('═', 72);
    std::cout << BOLD << WHITE << "  📚 whyWhale Help\n\n" << RESET;
    std::cout << "  whyWhale is an AI-powered code editor that:\n\n";
    std::cout << "  🤖 Generates complete, working code from your description\n";
    std::cout << "  🔁 Automatically fixes syntax and logic errors in a loop\n";
    std::cout << "  ▶  Executes code in real-time for 10+ languages\n";
    std::cout << "  🛠  Can fix YOUR broken code automatically\n";
    std::cout << "  🐋 Runs 100% locally using Ollama AI (no internet needed)\n\n";
    std::cout << "  Supported Languages:\n";
    std::cout << "  Python, C++, C, JavaScript, Java, Rust, Go, TypeScript, C#, Bash\n\n";
    std::cout << "  Tips:\n";
    std::cout << "  • Be specific in your task description for best results\n";
    std::cout << "  • Use 'dolphin-llama3' model for uncensored code generation\n";
    std::cout << "  • whyWhale will retry up to 10 times to fix errors\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RUN LOOP
// ─────────────────────────────────────────────────────────────────────────────
void EditorUI::run(const std::string& model) {
    OllamaManager ollama;
    AIEngine      ai(model);
    CodeExecutor  executor;
    ErrorFixer    fixer(ai, executor);

    std::cout << BOLD << GREEN
              << "\n  🐋 whyWhale is ready! Model: " << model << "\n"
              << RESET;

    while (true) {
        separator('═', 72);
        std::cout << BOLD << WHITE << "\n  🐋 whyWhale — Main Menu\n\n" << RESET;
        std::cout << "  [1]  🤖  New Coding Task     — Describe what to build\n";
        std::cout << "  [2]  🛠   Fix My Code         — Paste broken code to auto-fix\n";
        std::cout << "  [3]  ⚙   Settings             — Change model / pull models\n";
        std::cout << "  [4]  📚  Help                 — How to use whyWhale\n";
        std::cout << "  [5]  ❌  Exit\n\n";
        std::cout << "  > ";

        int choice;
        if (!(std::cin >> choice)) {
            std::cin.clear();
            std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');
            continue;
        }
        std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');

        switch (choice) {
            case 1: handleNewTask(ai, executor, fixer);     break;
            case 2: handleFixCode(ai, executor, fixer);     break;
            case 3: handleSettings(ai, ollama);              break;
            case 4: showHelp();                              break;
            case 5:
                std::cout << CYAN << "\n  🐋 Goodbye from whyWhale!\n\n" << RESET;
                return;
            default:
                std::cout << RED << "  Invalid choice.\n" << RESET;
        }
    }
}