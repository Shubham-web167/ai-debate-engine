# SYNTRIX Extension ⚖️🤖

A powerful Chrome extension that orchestrates autonomous debates between leading AI models (ChatGPT, Claude, and Gemini). Enter a single prompt, and watch as the AIs collaborate, critique each other's answers, and synthesize a final, highly accurate master response.

## ✨ Features

- **Multi-Model Orchestration:** Seamlessly commands ChatGPT, Claude, and Gemini simultaneously using their native web interfaces.
- **Autonomous Debate Workflow:** 
  1. **Initial Broadcast:** Sends your prompt to all selected models.
  2. **Cross-Critique:** Takes each model's answer and asks the others to review and critique it.
  3. **Similarity Trigger:** Intelligently decides if a second round of critique is necessary based on Jaccard similarity scoring.
  4. **Synthesis & Judge:** Elects a "Lead Judge" model to review the entire debate history and synthesize the ultimate answer.
- **Self-Healing Architecture:** Dynamically re-injects content scripts and recovers from page reloads or DOM changes (e.g., Claude's dynamic UI updates).
- **Robust UI Automation:** Uses multi-layered heuristics, negative filtering, and Enter-key fallbacks to guarantee prompt submission across constantly changing AI interfaces.
- **Real-Time Logging:** Beautiful, hacker-style terminal UI in the extension popup to monitor exactly what the orchestrator is doing in the background.

## 🚀 How It Works

This extension does not use expensive APIs. Instead, it leverages your existing active sessions in ChatGPT, Claude, and Gemini. 

The `background.js` orchestrator acts as the conductor, managing state machines and injecting platform-specific adapters (`adapters/chatgptAdapter.js`, `adapters/claudeAdapter.js`, etc.) into the respective tabs. These adapters interact with the DOM to type prompts, click send buttons, and extract generated responses.

## 🛠️ Installation

Since this extension requires broad host permissions to interact with AI platforms, it is intended for developer mode installation:

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing this repository (`ai-debate-engine`).
5. Ensure you are logged into [ChatGPT](https://chatgpt.com), [Claude](https://claude.ai), and [Gemini](https://gemini.google.com) in your browser.
6. Click the extension icon to launch the debate panel!

## ⚙️ Configuration & Architecture

- **`manifest.json`:** Defines MV3 permissions (`tabs`, `scripting`, `storage`, `alarms`) and content script injection rules.
- **State Machine (`stateMachine.js`):** Manages the complex multi-step asynchronous workflow (BROADCASTING → CRITIQUE → JUDGE).
- **Selector Engine (`config/selectors.json` & `utils/selectorResolver.js`):** A highly resilient semantic engine that finds input boxes and send buttons even when AI companies change their CSS class names.
- **Similarity Engine (`utils/similarity.js`):** Calculates Jaccard similarity between AI responses to decide if further debate rounds are mathematically necessary.

## 🤝 Contributing

This project is actively maintained to keep up with the frequent UI changes of major AI platforms. If an adapter breaks due to a UI update, pull requests updating the `selectors.json` or `selectorResolver.js` heuristics are highly appreciated!

## 📜 License

MIT License
