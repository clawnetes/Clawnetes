# Clawnetes 🦞

**The Native Installer for OpenClaw.**

Forget the terminal. Clawnetes is a friendly wizard that installs, configures, and launches your AI agent in 2 minutes.

If you'd like help us achieve the dream of an AI-first Company driven by a team of AI agents powered by OpenClaw, consider donating your desired amount to support Clawnetes's development. Thank you!

[Donate to help Clawnetes' development](https://buy.stripe.com/bJe3cwdjT4cyeDZdCS7wA00)

## 🚀 Supported Platforms

### macOS
1. Download the latest **`Clawnetes.dmg`** from the [Releases Page](../../releases).
2. Open the file and drag Clawnetes to your Applications folder.
3. **Important:** macOS may flag the app as damaged due to Gatekeeper. Run this command in Terminal to fix it:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Clawnetes.app
   ```
4. Launch Clawnetes from your Applications folder.
5. Follow the wizard to configure your agent with preset templates or custom settings.
6. Click **"Open Web Dashboard"** when finished.

### Windows
1. Download the latest **`.msi`** installer from the [Releases Page](../../releases).
2. Run the installer to setup Clawnetes on your system.
3. Open Clawnetes and follow the wizard instructions.

### Linux (Remote Installation)
*Note: We do not currently provide a native local Linux installer (e.g., AppImage or .deb).*

However, you can easily install OpenClaw onto a remote Linux server! Simply run the **Clawnetes** app on your macOS or Windows machine, choose the **Remote/Cloud** environment option, and provide your Linux server's SSH details. Clawnetes will handle the complete installation and configuration remotely.

## ✨ Features

### Core Capabilities
- **Native Chat Interface:** Built-in chat UI with real-time streaming, markdown rendering, thread management, and multi-agent routing
- **Agent Type Presets:** Choose from pre-configured agent templates:
  - **Coding Assistant** 👨‍💻 - Senior software engineer for code review, debugging, and development
  - **Office Assistant** 🤵 - Executive assistant for email, calendar, tasks, and communications
  - **Travel Planner** 🌍 - Expert travel agent for trip planning and logistics
- **Business Function Templates:** Multi-agent orchestration for complex workflows:
  - **Personal Productivity** 📋 - Email, calendar, reminders, and notes management
  - **Software Development** 💻 - Code review, testing, and GitHub integration
  - **Financial Analyst** 📊 - Data analysis, reporting, and market research
  - **Social Media Manager** 📱 - Content research, creation, and social media management
  - **Customer Support** 🎧 - Ticket triage, response drafting, and escalation management
- **Multi-Provider Support:** Anthropic, OpenAI, Google, OpenRouter, xAI, Ollama, LM Studio, and custom local models
- **Advanced Security:** Sandbox modes, tool policies, and granular permission controls
- **Messaging Integration:** Telegram and WhatsApp channel support with QR pairing
- **Skills & Tools:** 50+ integrations including GitHub, Slack, Trello, Apple Notes, Himalaya email, and more
- **Scheduled Tasks:** Cron job configuration for automated agent workflows
- **Session Management:** Heartbeat modes, idle timeouts, and multi-agent coordination

### Installation & Deployment
- **Auto-Dependency Check:** Verifies Node.js and required dependencies are ready
- **Smart Wizard:** Step-by-step configuration with validation and error handling
- **Remote Deployment:** Provision remote cloud instances securely over SSH directly from the UI
- **Local & Cloud:** Deploy on your machine or remote Linux servers
- **One-Click Launch:** Starts the agent and opens the web dashboard
- **Maintenance Mode:** Repair, audit, update, or uninstall existing installations

## 🤖 Supported Model Providers

Clawnetes supports a wide range of AI model providers, giving you flexibility to choose the best models for your use case:

### Cloud Providers
- **Anthropic** - Claude 3/3.5/3.7/4/4.5/4.6 (Haiku, Sonnet, Opus) with 200k-1M context
- **OpenAI** - GPT-4, GPT-4 Turbo, GPT-4.1, GPT-4o, GPT-5.x series, o1/o3/o4 reasoning models
- **Google** - Gemini 1.5/2.0/2.5/3/3.1 (Flash, Pro) with up to 1M context
- **xAI** - Grok 2/3/4 series models
- **OpenRouter** - Access to 100+ models from multiple providers through a unified API


### Local & Self-Hosted
- **Ollama** - Run Llama, Mistral, and other open models locally
- **LM Studio** - Local model hosting with custom base URL support
- **Custom Local** - Connect to any OpenAI-compatible API endpoint

### Authentication Methods
- **API Keys** - Direct token-based authentication
- **OAuth 2.0** - Secure browser-based authentication flow for supported providers
- **Profile-based Auth** - Reuse existing OpenClaw authentication profiles
- **Device Tokens** - Secure device-specific authentication

Each provider supports model fallbacks, allowing you to configure backup models if your primary model is unavailable or rate-limited.

## 🛠️ Developer Setup (Building from Source)

**Prerequisites:**
- Node.js (v20+)
- Rust (Cargo) - Install from [rustup.rs](https://rustup.rs)

```bash
# 1. Clone the repo
git clone https://github.com/aimodelscompass/Clawnetes.git
cd Clawnetes

# 2. Install dependencies
npm install

# 3. Run in Development Mode (Launches the GUI)
npm run tauri dev

# 4. Build Production Binary
npm run tauri build

# 5. Run Tests
npm run test              # Unit tests
npm run test:e2e          # E2E tests (requires built app)
```

## 🏗️ Architecture
- **Frontend:** React 18 + TypeScript + Vite (The Wizard UI)
- **Backend:** Rust + Tauri v2 (System calls, file writing, shell execution, SSH tunneling)
- **State Management:** Custom reducer-based wizard state with 25+ configuration steps
- **Testing:** Vitest for unit tests, Playwright for E2E tests
- **Build System:** Vite for fast development, Tauri CLI for native builds

---
*Built by [AI Models Compass](https://x.com/aimodelscompass).*
