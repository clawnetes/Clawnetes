import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/shell";
import { open as openDialog } from "@tauri-apps/api/dialog";
import "./App.css";

const MODELS_BY_PROVIDER: Record<string, Array<{ value: string; label: string }>> = {
  "amazon-bedrock": [
    { value: "amazon-bedrock/amazon.nova-2-lite-v1:0", label: "Amazon Nova 2 Lite" },
    { value: "amazon-bedrock/amazon.nova-lite-v1:0", label: "Amazon Nova Lite" },
    { value: "amazon-bedrock/amazon.nova-micro-v1:0", label: "Amazon Nova Micro" },
    { value: "amazon-bedrock/amazon.nova-premier-v1:0", label: "Amazon Nova Premier" },
    { value: "amazon-bedrock/amazon.nova-pro-v1:0", label: "Amazon Nova Pro" },
    { value: "amazon-bedrock/amazon.titan-text-express-v1", label: "Amazon Titan Text Express" },
    { value: "amazon-bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0", label: "Claude 3.7 Sonnet" },
    { value: "amazon-bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0", label: "Claude 3.5 Sonnet v2" },
    { value: "amazon-bedrock/anthropic.claude-3-5-haiku-20241022-v1:0", label: "Claude 3.5 Haiku" },
    { value: "amazon-bedrock/anthropic.claude-opus-4-6-v1:0", label: "Claude Opus 4.6" },
    { value: "amazon-bedrock/deepseek.r1-v1:0", label: "DeepSeek R1" },
    { value: "amazon-bedrock/deepseek.v3-v1:0", label: "DeepSeek V3" },
    { value: "amazon-bedrock/meta.llama3-3-70b-instruct-v1:0", label: "Llama 3.3 70B" },
    { value: "amazon-bedrock/meta.llama4-maverick-17b-v1:0", label: "Llama 4 Maverick" },
    { value: "amazon-bedrock/meta.llama4-scout-17b-v1:0", label: "Llama 4 Scout" },
    { value: "amazon-bedrock/mistral.mistral-large-2411-v1:0", label: "Mistral Large 24.11" },
    { value: "amazon-bedrock/qwen.qwen3-235b-a22b-v1:0", label: "Qwen 3 235B" },
  ],
  "anthropic": [
    { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
    { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { value: "anthropic/claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet (Latest)" },
    { value: "anthropic/claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet (2025-02-19)" },
    { value: "anthropic/claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet (Latest)" },
    { value: "anthropic/claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (Latest)" },
    { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5" },
    { value: "anthropic/claude-3-opus-20240229", label: "Claude 3 Opus" },
    { value: "anthropic/claude-3-haiku-20240307", label: "Claude 3 Haiku" },
  ],
  "azure-openai-responses": [
    { value: "azure-openai-responses/gpt-4o", label: "GPT-4o" },
    { value: "azure-openai-responses/gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "azure-openai-responses/gpt-5", label: "GPT-5" },
    { value: "azure-openai-responses/gpt-5-pro", label: "GPT-5 Pro" },
    { value: "azure-openai-responses/o1", label: "o1" },
    { value: "azure-openai-responses/o3-mini", label: "o3-mini" },
    { value: "azure-openai-responses/o4-mini", label: "o4-mini" },
    { value: "azure-openai-responses/codex-mini-latest", label: "Codex Mini" },
  ],
  "cerebras": [
    { value: "cerebras/gpt-oss-120b", label: "GPT OSS 120B" },
    { value: "cerebras/qwen-3-235b-a22b-instruct-2507", label: "Qwen 3 235B" },
    { value: "cerebras/zai-glm-4.7", label: "GLM 4.7" },
  ],
  "github-copilot": [
    { value: "github-copilot/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
    { value: "github-copilot/claude-opus-4-6", label: "Claude Opus 4.6" },
    { value: "github-copilot/gpt-4o", label: "GPT-4o" },
    { value: "github-copilot/gpt-5", label: "GPT-5" },
    { value: "github-copilot/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "github-copilot/grok-code-fast-1", label: "Grok Code Fast" },
  ],
  "google": [
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { value: "google/gemini-2.0-pro-preview-05-06", label: "Gemini 2.0 Pro Preview" },
    { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "google/gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { value: "google/gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
    { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
    { value: "google/gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { value: "google/gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    { value: "google/gemini-live-2.5-flash", label: "Gemini Live 2.5 Flash" },
  ],
  "google-antigravity": [
    { value: "google-antigravity/claude-opus-4-5-thinking", label: "Claude Opus 4.5 Thinking" },
    { value: "google-antigravity/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { value: "google-antigravity/gemini-3-pro-high", label: "Gemini 3 Pro High" },
    { value: "google-antigravity/gpt-oss-120b-medium", label: "GPT OSS 120B Medium" },
  ],
  "google-gemini-cli": [
    { value: "google-gemini-cli/gemini-3-pro-preview", label: "Gemini 3 Pro" },
    { value: "google-gemini-cli/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "google-gemini-cli/gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  "google-vertex": [
    { value: "google-vertex/gemini-3-pro-preview", label: "Gemini 3 Pro (Vertex)" },
    { value: "google-vertex/gemini-2.5-pro", label: "Gemini 2.5 Pro (Vertex)" },
    { value: "google-vertex/gemini-2.0-flash", label: "Gemini 2.0 Flash (Vertex)" },
    { value: "google-vertex/gemini-1.5-pro", label: "Gemini 1.5 Pro (Vertex)" },
  ],
  "groq": [
    { value: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { value: "groq/llama-3.1-8b-instant", label: "Llama 3.1 8B" },
    { value: "groq/deepseek-r1-distill-llama-70b", label: "DeepSeek R1 70B" },
    { value: "groq/qwen-qwq-32b", label: "Qwen QWQ 32B" },
    { value: "groq/mistral-saba-24b", label: "Mistral Saba 24B" },
  ],
  "huggingface": [
    { value: "huggingface/deepseek-ai/DeepSeek-V3.2", label: "DeepSeek V3.2" },
    { value: "huggingface/Qwen/Qwen3-235B-A22B-Thinking", label: "Qwen 3 235B Thinking" },
    { value: "huggingface/moonshotai/Kimi-K2.5", label: "Kimi K2.5" },
    { value: "huggingface/zai-org/GLM-4.7", label: "GLM 4.7" },
  ],
  "kimi-coding": [
    { value: "kimi-coding/k2p5", label: "Kimi K2.5" },
    { value: "kimi-coding/kimi-k2-thinking", label: "Kimi K2 Thinking" },
  ],
  "minimax": [
    { value: "minimax/MiniMax-M2.1", label: "MiniMax M2.1" },
    { value: "minimax-cn/MiniMax-M2.1", label: "MiniMax M2.1 (China)" },
  ],
  "mistral": [
    { value: "mistral/mistral-large-latest", label: "Mistral Large" },
    { value: "mistral/mistral-medium-latest", label: "Mistral Medium" },
    { value: "mistral/codestral-latest", label: "Codestral" },
    { value: "mistral/pixtral-large-latest", label: "Pixtral Large" },
    { value: "mistral/ministral-8b-latest", label: "Ministral 8B" },
    { value: "mistral/mistral-nemo", label: "Mistral Nemo" },
  ],
  "openai": [
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "openai/gpt-5", label: "GPT-5" },
    { value: "openai/gpt-5-pro", label: "GPT-5 Pro" },
    { value: "openai/o1-pro", label: "o1 Pro" },
    { value: "openai/o3-mini", label: "o3-mini" },
    { value: "openai/o4-mini", label: "o4-mini" },
    { value: "openai/gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "openai/codex-mini-latest", label: "Codex Mini" },
  ],
  "openai-codex": [
    { value: "openai-codex/gpt-5.2-codex", label: "GPT 5.2 Codex" },
    { value: "openai-codex/gpt-5.1-codex-max", label: "GPT 5.1 Codex Max" },
  ],
  "opencode": [
    { value: "opencode/claude-opus-4-6", label: "Claude Opus 4.6 (Free)" },
    { value: "opencode/gemini-3-pro", label: "Gemini 3 Pro (Free)" },
    { value: "opencode/gpt-5.1", label: "GPT 5.1 (Free)" },
    { value: "opencode/kimi-k2.5-free", label: "Kimi K2.5 (Free)" },
    { value: "opencode/qwen3-coder", label: "Qwen 3 Coder (Free)" },
  ],
  "openrouter": [
    { value: "openrouter/auto", label: "Auto (Best for Task)" },
    { value: "openrouter/anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
    { value: "openrouter/openai/gpt-4o", label: "GPT-4o" },
    { value: "openrouter/google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "openrouter/deepseek/deepseek-r1", label: "DeepSeek R1" },
    { value: "openrouter/meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    { value: "openrouter/x-ai/grok-3", label: "Grok-3" },
    { value: "openrouter/mistralai/mistral-large-2512", label: "Mistral Large 25.12" },
    { value: "openrouter/qwen/qwen3-235b-a22b-thinking", label: "Qwen 3 Thinking" },
  ],
  "vercel-ai-gateway": [
    { value: "vercel-ai-gateway/anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
    { value: "vercel-ai-gateway/openai/gpt-5", label: "GPT-5" },
    { value: "vercel-ai-gateway/google/gemini-3-pro-preview", label: "Gemini 3 Pro" },
    { value: "vercel-ai-gateway/deepseek/deepseek-v3.1", label: "DeepSeek V3.1" },
    { value: "vercel-ai-gateway/xai/grok-4", label: "Grok-4" },
  ],
  "xai": [
    { value: "xai/grok-3", label: "Grok-3" },
    { value: "xai/grok-3-mini", label: "Grok-3 Mini" },
    { value: "xai/grok-4", label: "Grok-4" },
    { value: "xai/grok-2-latest", label: "Grok-2" },
    { value: "xai/grok-code-fast-1", label: "Grok Code Fast" },
  ],
  "zai": [
    { value: "zai/glm-4.7", label: "GLM 4.7" },
    { value: "zai/glm-4.6", label: "GLM 4.6" },
    { value: "zai/glm-4.5-air", label: "GLM 4.5 Air" },
  ],
  "ollama": [
    { value: "ollama/llama3.1", label: "Llama 3.1 (Local)" },
    { value: "ollama/deepseek-r1", label: "DeepSeek R1 (Local)" },
  ]
};

// Reusable Radio Card Component
const PROVIDER_LOGOS: Record<string, string> = {
  "anthropic": "/images/anthropic.svg",
  "openai": "/images/openai.svg",
  "google": "/images/google.svg",
  "openrouter": "/images/openrouter.svg",
  "ollama": "/images/ollama.svg",
  "amazon-bedrock": "/images/aws.svg",
  "azure-openai-responses": "/images/azure.svg",
  "cerebras": "/images/cerebras.svg",
  "github-copilot": "/images/github.svg",
  "google-antigravity": "/images/google.svg",
  "google-gemini-cli": "/images/google.svg",
  "google-vertex": "/images/google.svg",
  "groq": "/images/groq.svg",
  "huggingface": "/images/huggingface.svg",
  "kimi-coding": "/images/moonshot.svg",
  "minimax": "/images/minimax.svg",
  "mistral": "/images/mistral.svg",
  "openai-codex": "/images/openai.svg",
  "opencode": "/images/code.svg",
  "vercel-ai-gateway": "/images/vercel.svg",
  "xai": "/images/grok.svg",
  "zai": "/images/zhipu.svg"
};

const SKILL_ICONS: Record<string, string> = {
  "1password": "/images/1password.svg",
  "apple-notes": "/images/apple-notes.svg",
  "apple-reminders": "/images/checklist.svg",
  "bear-notes": "/images/bear.svg",
  "blogwatcher": "/images/terminal.svg",
  "blucli": "/images/terminal.svg",
  "bluebubbles": "/images/message.svg",
  "camsnap": "/images/camera.svg",
  "clawhub": "/images/terminal.svg",
  "coding-agent": "/images/code.svg",
  "eightctl": "/images/moon.svg",
  "gemini": "/images/google.svg",
  "gifgrep": "/images/terminal.svg",
  "github": "/images/github.svg",
  "gog": "/images/google-drive.svg",
  "goplaces": "/images/google-maps.svg",
  "healthcheck": "/images/terminal.svg",
  "himalaya": "/images/terminal.svg",
  "imsg": "/images/message.svg",
  "local-places": "/images/google-maps.svg",
  "mcporter": "/images/terminal.svg",
  "model-usage": "/images/chart.svg",
  "nano-banana-pro": "/images/google.svg",
  "nano-pdf": "/images/pdf.svg",
  "notion": "/images/notion.svg",
  "obsidian": "/images/obsidian.svg",
  "openai-image-gen": "/images/openai.svg",
  "openai-whisper": "/images/openai.svg",
  "openai-whisper-api": "/images/openai.svg",
  "openhue": "/images/philips-hue.svg",
  "oracle": "/images/terminal.svg",
  "ordercli": "/images/terminal.svg",
  "peekaboo": "/images/camera.svg",
  "sag": "/images/mic.svg",
  "session-logs": "/images/chart.svg",
  "sherpa-onnx-tts": "/images/mic.svg",
  "skill-creator": "/images/code.svg",
  "slack": "/images/slack.svg",
  "songsee": "/images/chart.svg",
  "sonoscli": "/images/sonos.svg",
  "spotify-player": "/images/spotify.svg",
  "summarize": "/images/pdf.svg",
  "things-mac": "/images/checklist.svg",
  "tmux": "/images/terminal.svg",
  "trello": "/images/trello.svg",
  "video-frames": "/images/camera.svg",
  "voice-call": "/images/mic.svg",
  "wacli": "/images/whatsapp.svg",
  "weather": "/images/weather.svg"
};

function RadioCard({ 
  options, 
  value, 
  onChange, 
  columns = 2 
}: { 
  options: { value: string; label: string; description?: string; icon?: string }[]; 
  value: string; 
  onChange: (val: string) => void; 
  columns?: 1 | 2 | 3 
}) {
  return (
    <div className={`radio-card-grid cols-${columns}`}>
      {options.map((opt) => (
        <div
          key={opt.value}
          className={`radio-card ${value === opt.value ? "active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          <div className="radio-card-label" style={{display: "flex", alignItems: "center"}}>
            <div className={`radio-circle ${value === opt.value ? "checked" : ""}`} style={{
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              border: `2px solid ${value === opt.value ? "var(--primary)" : "var(--text-muted)"}`,
              backgroundColor: value === opt.value ? "var(--primary)" : "transparent",
              marginRight: "10px",
              flexShrink: 0
            }} />
            {opt.icon && (
               <img 
                 src={opt.icon} 
                 alt="" 
                 style={{
                   width: "24px", 
                   height: "24px", 
                   marginRight: "10px", 
                   borderRadius: "6px",
                   objectFit: "contain",
                   backgroundColor: "white",
                   padding: "2px"
                 }} 
               />
            )}
            <span style={{fontWeight: 600}}>{opt.label}</span>
          </div>
          {opt.description && (
             <div className="radio-card-desc" style={{
               paddingLeft: opt.icon ? "60px" : "28px", 
               marginTop: "4px"
             }}>
               {opt.description}
             </div>
          )}
        </div>
      ))}
    </div>
  );
}

function App() {
  const [step, setStep] = useState(0.5); // Start at Welcome page
  const [mode, setMode] = useState("basic"); // "basic" or "advanced"
  
  // Environment selection
  const [targetEnvironment, setTargetEnvironment] = useState("local");

  // SSH Remote Configuration
  const [remoteIp, setRemoteIp] = useState("");
  const [remoteUser, setRemoteUser] = useState("");
  const [remotePassword, setRemotePassword] = useState("");
  const [remotePrivateKeyPath, setRemotePrivateKeyPath] = useState("");
  const [sshStatus, setSshStatus] = useState<"idle" | "checking" | "requesting_password" | "success" | "error">("idle");
  const [sshError, setSshError] = useState("");
  const [tunnelActive, setTunnelActive] = useState(false);

  const [checks, setChecks] = useState({ node: false, docker: false, openclaw: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [logs, setLogs] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [installingNode, setInstallingNode] = useState(false);
  const [nodeInstallError, setNodeInstallError] = useState("");

  // Form Data
  const [userName, setUserName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentVibe, setAgentVibe] = useState("Professional");
  const [apiKey, setApiKey] = useState("");
  const [authMethod, setAuthMethod] = useState("token"); 
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("anthropic/claude-opus-4-6");
  const [telegramToken, setTelegramToken] = useState("");
  const [progress, setProgress] = useState("");
  const [dashboardUrl, setDashboardUrl] = useState("http://127.0.0.1:18789");
  const [openClawVersion, setOpenClawVersion] = useState("Checking...");
  const [maintenanceStatus, setMaintenanceStatus] = useState("");
  const [selectedMaint, setSelectedMaint] = useState<string>("repair");
  const [maintCompleted, setMaintCompleted] = useState(false);

  // Service Keys State
  const [serviceKeys, setServiceKeys] = useState<Record<string, string>>({});
  const [currentServiceIdx, setCurrentServiceIdx] = useState(0);
  const [isConfiguringService, setIsConfiguringService] = useState<boolean | null>(false);

  const servicesToConfigure = [
    { id: "goplaces", name: "Google Places", placeholder: "API Key" },
    { id: "notion", name: "Notion", placeholder: "Internal Integration Token" },
    { id: "elevenlabs", name: "ElevenLabs (SAG)", placeholder: "API Key" },
    { id: "nano-banana", name: "Nano Banana Pro", placeholder: "API Key" },
    { id: "openai-images", name: "OpenAI Image Gen", placeholder: "API Key" }
  ];

  // Advanced Form Data
  const [gatewayPort, setGatewayPort] = useState(18789);
  const [gatewayBind, setGatewayBind] = useState("loopback");
  const [gatewayAuthMode, setGatewayAuthMode] = useState("token");
  const [tailscaleMode, setTailscaleMode] = useState("off");
  const [nodeManager, setNodeManager] = useState("npm");
  const [selectedSkills, setSelectedSkills] = useState<string[]>(["filesystem", "terminal"]);
  const [skipBasicConfig, setSkipBasicConfig] = useState(false);

  // NEW: Security Best Practices (Step 11)
  const [sandboxMode, setSandboxMode] = useState("full");
  const [toolsMode, setToolsMode] = useState("allowlist");
  const [allowedTools, setAllowedTools] = useState<string[]>(["filesystem", "terminal", "browser"]);
  const [deniedTools, setDeniedTools] = useState<string[]>([]);

  // NEW: Fallback Models (Step 12)
  const [enableFallbacks, setEnableFallbacks] = useState(false);
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);

  // NEW: Session Management (Step 13)
  const [heartbeatMode, setHeartbeatMode] = useState("1h");
  const [idleTimeoutMs, setIdleTimeoutMs] = useState(3600000);

  // NEW: Multi-Agent (Step 15)
  const [enableMultiAgent, setEnableMultiAgent] = useState(false);
  const [numAgents, setNumAgents] = useState(1);
  const [agentConfigs, setAgentConfigs] = useState<Array<{
    id: string;
    name: string;
    model: string;
    fallbackModels: string[];
    skills: string[];
    vibe: string;
    identityMd: string;
    userMd: string;
    soulMd: string;
  }>>([]);
  const [currentAgentConfigIdx, setCurrentAgentConfigIdx] = useState(0);
  // const [isConfiguringAgent, setIsConfiguringAgent] = useState(false);

  // NEW: Workspace Customization (Step 16)
  const [identityMd, setIdentityMd] = useState("");
  const [userMd, setUserMd] = useState("");
  const [soulMd, setSoulMd] = useState("");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("identity");
  const [initialWorkspace, setInitialWorkspace] = useState({ identity: "", user: "", soul: "" });
  const [workspaceModified, setWorkspaceModified] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);

  // NEW: Custom Skills
  const [customSkillName, setCustomSkillName] = useState("");
  const [customSkillContent, setCustomSkillContent] = useState("");
  const [showCustomSkillForm, setShowCustomSkillForm] = useState(false);

  // Pairing Data
  const [pairingInput, setPairingInput] = useState("");
  const [pairingStatus, setPairingStatus] = useState("");
  const [isPaired, setIsPaired] = useState(false);
  const [theme, setTheme] = useState("dark");

  const availableSkills = [
    { id: "1password", name: "1Password", desc: "Set up and use 1Password CLI (op) for secrets management." },
    { id: "apple-notes", name: "Apple Notes", desc: "Manage Apple Notes on macOS (create, view, edit, search)." },
    { id: "apple-reminders", name: "Apple Reminders", desc: "Manage Apple Reminders on macOS (list, add, complete)." },
    { id: "bear-notes", name: "Bear Notes", desc: "Create, search, and manage Bear notes via grizzly CLI." },
    { id: "blogwatcher", name: "Blogwatcher", desc: "Monitor blogs and RSS/Atom feeds for updates." },
    { id: "blucli", name: "BluOS", desc: "BluOS CLI for discovery, playback, and volume control." },
    { id: "bluebubbles", name: "BlueBubbles", desc: "Send or manage iMessages via BlueBubbles.", requiresAuth: true, authPlaceholder: "Server URL & Password" },
    { id: "camsnap", name: "CamSnap", desc: "Capture frames or clips from RTSP/ONVIF cameras." },
    { id: "clawhub", name: "ClawHub", desc: "Search, install, update, and publish agent skills." },
    { id: "coding-agent", name: "Coding Agent", desc: "Run Codex, Claude Code, or OpenCode programmatic agents." },
    { id: "eightctl", name: "Eight Sleep", desc: "Control Eight Sleep pods (status, temperature, alarms)." },
    { id: "gemini", name: "Gemini CLI", desc: "Gemini CLI for one-shot Q&A, summaries, and generation." },
    { id: "gifgrep", name: "GifGrep", desc: "Search GIF providers, download results, and extract frames." },
    { id: "github", name: "GitHub", desc: "Interact with GitHub using the gh CLI (issues, PRs, runs)." },
    { id: "gog", name: "Google Workspace", desc: "CLI for Gmail, Calendar, Drive, Docs, Sheets, and Contacts." },
    { id: "goplaces", name: "Google Places", desc: "Query Google Places API for search and details.", requiresAuth: true, authPlaceholder: "API Key" },
    { id: "healthcheck", name: "Healthcheck", desc: "Host security hardening and risk-tolerance configuration." },
    { id: "himalaya", name: "Himalaya (Email)", desc: "CLI to manage emails via IMAP/SMTP." },
    { id: "imsg", name: "iMessage", desc: "Native macOS iMessage/SMS CLI for chats and sending." },
    { id: "local-places", name: "Local Places", desc: "Search for places via Google Places API proxy." },
    { id: "mcporter", name: "MCPorter", desc: "List, configure, and call MCP servers/tools directly." },
    { id: "model-usage", name: "Model Usage", desc: "Summarize per-model usage/cost for Codex or Claude." },
    { id: "nano-banana-pro", name: "Nano Banana Pro", desc: "Generate or edit images via Gemini 3 Pro Image.", requiresAuth: true, authPlaceholder: "API Key" },
    { id: "nano-pdf", name: "Nano PDF", desc: "Edit PDFs with natural-language instructions." },
    { id: "notion", name: "Notion", desc: "Create and manage Notion pages and databases.", requiresAuth: true, authPlaceholder: "Integration Token" },
    { id: "obsidian", name: "Obsidian", desc: "Work with Obsidian vaults via obsidian-cli." },
    { id: "openai-image-gen", name: "OpenAI Images", desc: "Batch-generate images via OpenAI Images API.", requiresAuth: true, authPlaceholder: "API Key" },
    { id: "openai-whisper", name: "Whisper (Local)", desc: "Local speech-to-text with the Whisper CLI (no API key)." },
    { id: "openai-whisper-api", name: "Whisper API", desc: "Transcribe audio via OpenAI Audio API.", requiresAuth: true, authPlaceholder: "API Key" },
    { id: "openhue", name: "Philips Hue", desc: "Control Philips Hue lights/scenes via OpenHue CLI." },
    { id: "oracle", name: "Oracle", desc: "Best practices for using the oracle CLI." },
    { id: "ordercli", name: "OrderCLI", desc: "Foodora-only CLI for checking past/active orders." },
    { id: "peekaboo", name: "Peekaboo", desc: "Capture and automate macOS UI." },
    { id: "sag", name: "ElevenLabs TTS", desc: "ElevenLabs text-to-speech with mac-style say UX.", requiresAuth: true, authPlaceholder: "API Key" },
    { id: "session-logs", name: "Session Logs", desc: "Search and analyze your own session logs." },
    { id: "sherpa-onnx-tts", name: "Sherpa ONNX TTS", desc: "Local text-to-speech via sherpa-onnx (offline)." },
    { id: "skill-creator", name: "Skill Creator", desc: "Create or update AgentSkills." },
    { id: "slack", name: "Slack", desc: "Control Slack (messages, reactions, pins).", requiresAuth: true, authPlaceholder: "Bot Token" },
    { id: "songsee", name: "SongSee", desc: "Generate spectrograms and feature-panel visualizations." },
    { id: "sonoscli", name: "Sonos", desc: "Control Sonos speakers (status, playback, volume)." },
    { id: "spotify-player", name: "Spotify", desc: "Terminal Spotify playback/search via spogo." },
    { id: "summarize", name: "Summarize", desc: "Summarize text/transcripts from URLs and files." },
    { id: "things-mac", name: "Things 3", desc: "Manage Things 3 on macOS (add, list, search tasks)." },
    { id: "tmux", name: "Tmux", desc: "Remote-control tmux sessions for interactive CLIs." },
    { id: "trello", name: "Trello", desc: "Manage Trello boards, lists, and cards.", requiresAuth: true, authPlaceholder: "API Key & Token" },
    { id: "video-frames", name: "Video Frames", desc: "Extract frames or short clips from videos." },
    { id: "voice-call", name: "Voice Call", desc: "Start voice calls via the OpenClaw voice-call plugin." },
    { id: "wacli", name: "WhatsApp", desc: "Send WhatsApp messages via wacli CLI." },
    { id: "weather", name: "Weather", desc: "Get current weather and forecasts." }
  ];

  const stepsList = [
    { id: 0, name: "System State", hidden: true },
    { id: 0.5, name: "Welcome", hidden: true },
    { id: 1, name: "Environment" },
    { id: 2, name: "System Check" },
    { id: 3, name: "Security" },
    { id: 5, name: "Identity" },
    { id: 6, name: "Agent" },
    { id: 7, name: "Gateway", advanced: true },
    { id: 8, name: "Brain" },
    { id: 9, name: "Channels" },
    { id: 10, name: "Runtime", advanced: true },
    { id: 10.5, name: "Workspace", advanced: true },
    { id: 11, name: "Skills", advanced: true },
    { id: 12, name: "Security+", advanced: true },
    { id: 13, name: "Fallbacks", advanced: true },
    { id: 14, name: "Session", advanced: true },
    { id: 15, name: "Agents", advanced: true },
    { id: 17, name: "Pairing" }
  ];

  useEffect(() => { checkSystem(true); }, []);

  useEffect(() => {
    if (theme === "light") {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
  }, [theme]);

  // Update default auth method when provider changes
  useEffect(() => {
    if (provider === "anthropic") setAuthMethod("token");
    else if (provider === "google") setAuthMethod("token");
    else if (provider === "openai") setAuthMethod("token");
    else setAuthMethod("token");
  }, [provider]);

  // Workspace change detection
  useEffect(() => {
    const modified =
      identityMd !== initialWorkspace.identity ||
      userMd !== initialWorkspace.user ||
      soulMd !== initialWorkspace.soul;
    setWorkspaceModified(modified);
  }, [identityMd, userMd, soulMd, initialWorkspace]);

  async function installLocalNode() {
    setInstallingNode(true);
    setNodeInstallError("");
    try {
      await invoke("install_local_nodejs");
      await checkSystem(false);
    } catch (e: any) {
      setNodeInstallError("Failed to install: " + e);
    } finally {
      setInstallingNode(false);
    }
  }

  async function checkSystem(skipRedirect = false) {
    // Always check local system on initial load
    const res: any = await invoke("check_prerequisites");
    setChecks({
      node: res.node_installed,
      docker: res.docker_running,
      openclaw: res.openclaw_installed
    });
    const version: string = await invoke("get_openclaw_version");
    setOpenClawVersion(version);

    if (res.openclaw_installed && !skipRedirect) {
      setStep(0);
      return true; // Indicate that we're going to maintenance
    } else if (!skipRedirect) {
      setStep(0.5); // Go to Welcome page if not installed
    }
    return res.openclaw_installed; // Return installation status
  }

  async function checkRemoteSystem(skipRedirect = false) {
    // Check remote system (called from Step 1 when cloud environment is selected)
    if (sshStatus === "success") {
      const remote = {
        ip: remoteIp,
        user: remoteUser,
        password: remotePassword || null,
        privateKeyPath: remotePrivateKeyPath || null
      };
      
      const res: any = await invoke("check_remote_prerequisites", { remote });
      setChecks({
        node: res.node_installed,
        docker: res.docker_running,
        openclaw: res.openclaw_installed
      });
      const version: string = await invoke("get_remote_openclaw_version", { remote });
      setOpenClawVersion(version);

      // If OpenClaw is already installed remotely, go to maintenance screen (unless skipping)
      if (res.openclaw_installed && !skipRedirect) {
        setStep(0);
        return true; // Indicate that we're going to maintenance
      }
      return res.openclaw_installed; // Return installation status
    }
    return false;
  }

  function formatSshError(error: string): string {
    const errorLower = error.toLowerCase();

    // Authentication errors
    if (errorLower.includes("no identities found in the ssh agent")) {
      return "SSH agent has no keys loaded. Try using a password or specifying a key file.";
    }
    if (errorLower.includes("all authentication methods failed") || errorLower.includes("ssh authentication failed")) {
      return "Authentication failed. Please check your username, password, or SSH key.";
    }
    if (errorLower.includes("public key auth failed") || errorLower.includes("publickey")) {
      return "SSH key authentication failed. Check that your key is correct and has proper permissions.";
    }
    if (errorLower.includes("password auth failed") || errorLower.includes("authentication failed")) {
      return "Password authentication failed. Please check your password.";
    }
    if (errorLower.includes("permission denied")) {
      return "Permission denied. Check your username and authentication credentials.";
    }

    // Connection errors
    if (errorLower.includes("connection refused")) {
      return "Connection refused. Check that SSH is running on the server (port 22).";
    }
    if (errorLower.includes("connection timed out") || errorLower.includes("timeout")) {
      return "Connection timed out. Check the IP address and network connectivity.";
    }
    if (errorLower.includes("no route to host")) {
      return "Cannot reach the server. Check the IP address and network settings.";
    }
    if (errorLower.includes("network is unreachable")) {
      return "Network unreachable. Check your internet connection.";
    }
    if (errorLower.includes("cannot reach")) {
      return "Cannot connect to the server. Check the IP address and port.";
    }

    // Handshake errors
    if (errorLower.includes("handshake failed")) {
      return "SSH handshake failed. The server may not support SSH protocol.";
    }

    // Key file errors
    if (errorLower.includes("no such file") || errorLower.includes("file not found")) {
      return "SSH key file not found. Check the file path.";
    }
    if (errorLower.includes("invalid format") || errorLower.includes("bad key")) {
      return "Invalid SSH key format. Ensure the key file is a valid private key.";
    }

    // Default: show a simplified version
    const firstLine = error.split('\n')[0];
    if (firstLine.length > 100) {
      return "Connection failed. Please check your settings and try again.";
    }
    return firstLine.replace(/Error: /g, '').trim();
  }

  async function handleSshCheck() {
    if (!remoteIp || !remoteUser) {
      setSshError("Please provide IP address and username");
      setTimeout(() => setSshError(""), 30000);
      return;
    }

    setSshStatus("checking");
    setSshError("");

    try {
      // Changed to use object parameter to match backend
      const checkPromise = invoke("test_ssh_connection", {
        remote: {
          ip: remoteIp,
          user: remoteUser,
          password: remotePassword || null,
          privateKeyPath: remotePrivateKeyPath || null
        }
      });

      // Timeout after 15 seconds
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Connection timed out")), 15000)
      );

      await Promise.race([checkPromise, timeoutPromise]);

      setSshStatus("success");
      setSshError("");
    } catch (e) {
      setSshStatus("idle"); // Reset to idle on error so user can retry
      const friendlyError = formatSshError(String(e));
      setSshError(friendlyError);
      setTimeout(() => setSshError(""), 30000);
    }
  }

  async function handleSaveWorkspace(agentId?: string) {
    setSavingWorkspace(true);
    try {
      await invoke("save_workspace_files", {
        agentId: agentId || null,
        identity: identityMd,
        user: userMd,
        soul: soulMd
      });
      // Update initial workspace to current values
      setInitialWorkspace({
        identity: identityMd,
        user: userMd,
        soul: soulMd
      });
      setWorkspaceModified(false);
    } catch (e) {
      console.error("Failed to save workspace:", e);
      alert("Failed to save workspace: " + e);
    }
    setSavingWorkspace(false);
  }

  async function handleInstall() {
    setLoading(true);
    setError(false);
    setProgress("Starting setup...");

    const mappedSandboxMode = sandboxMode === "full" ? "all" : (sandboxMode === "partial" ? "non-main" : "off");

    try {
      if (targetEnvironment === "cloud") {
        // Remote installation flow
        setProgress("Setting up OpenClaw on remote server...");
        setLogs("Installing OpenClaw on remote server...");

        const remoteConfig = {
          ip: remoteIp,
          user: remoteUser,
          password: remotePassword || null,
          privateKeyPath: remotePrivateKeyPath || null
        };

        await invoke("setup_remote_openclaw", {
          remote: remoteConfig,
          config: {
            provider,
            api_key: apiKey,
            auth_method: authMethod,
            model,
            user_name: userName,
            agent_name: agentName,
            agent_vibe: agentVibe,
            telegram_token: telegramToken,
            // Gateway settings
            gateway_port: gatewayPort,
            gateway_bind: gatewayBind,
            gateway_auth_mode: gatewayAuthMode,
            tailscale_mode: tailscaleMode,
            // Runtime settings
            node_manager: nodeManager,
            skills: selectedSkills,
            service_keys: serviceKeys,
            // Advanced security settings
            sandbox_mode: mode === "advanced" ? sandboxMode : null,
            tools_mode: mode === "advanced" ? toolsMode : null,
            allowed_tools: mode === "advanced" && toolsMode === "allowlist" ? allowedTools : null,
            denied_tools: mode === "advanced" && toolsMode === "denylist" ? deniedTools : null,
            // Fallback models
            fallback_models: mode === "advanced" && enableFallbacks ? fallbackModels.filter(m => m) : null,
            // Session management
            heartbeat_mode: mode === "advanced" ? heartbeatMode : null,
            idle_timeout_ms: mode === "advanced" && heartbeatMode === "idle" ? idleTimeoutMs : null,
            // Workspace customization
            identity_md: mode === "advanced" && identityMd ? identityMd : null,
            user_md: mode === "advanced" && userMd ? userMd : null,
            soul_md: mode === "advanced" && soulMd ? soulMd : null,
            // Multi-agent support
            agents: enableMultiAgent ? agentConfigs.map(a => ({
              id: a.id,
              name: a.name,
              model: a.model,
              fallback_models: a.fallbackModels.length > 0 ? a.fallbackModels : null,
              skills: a.skills.length > 0 ? a.skills : null,
              vibe: a.vibe,
              identity_md: a.identityMd || null,
              user_md: a.userMd || null,
              soul_md: a.soulMd || null
            })) : null,
            preserve_state: isPaired
          }
        });

        // Install skills on remote server
        for (const skill of selectedSkills) {
          setProgress(`Installing skill on remote: ${skill}...`);
          setLogs(`Installing skill: ${skill}...`);
          try {
            await invoke("install_remote_skill", {
              remote: remoteConfig,
              name: skill
            });
          } catch (e) {
            console.error(`Failed to install skill ${skill}:`, e);
            setLogs(prev => prev + `\nWarning: Failed to install skill ${skill}: ${e}`);
          }
        }

        setProgress("Establishing SSH tunnel...");
        setLogs("Creating SSH tunnel to remote gateway...");
        try {
          await invoke("start_ssh_tunnel", { remote: remoteConfig });
        } catch (e: any) {
          if (String(e).includes("SSH tunnel is already running")) {
            setLogs(prev => prev + "\nTunnel already active.");
          } else {
            throw e;
          }
        }
        setTunnelActive(true);

        // Verify tunnel is working with HTTP connectivity test
        setProgress("Verifying tunnel connectivity...");
        try {
          const tunnelWorking: boolean = await invoke("verify_tunnel_connectivity", {
            remote: remoteConfig
          });
          if (!tunnelWorking) {
            throw new Error("Tunnel established but HTTP connectivity test failed");
          }
        } catch (e) {
          setProgress("");
          setLogs("Error: Tunnel verification failed - " + e);
          setError(true);
          setTunnelActive(false);
          setLoading(false);
          return;
        }

        setProgress("Finalizing setup...");
        if (!isPaired) {
          const instruction: string = await invoke("generate_pairing_code");
          setPairingCode(instruction);
        }

        // Get dashboard URL (tunneled)
        const url: string = await invoke("get_dashboard_url", {
          isRemote: true,
          remote: remoteConfig
        });
        setDashboardUrl(url);

        setProgress("");
        setStep(17);
      } else {
        // Local installation flow
        setProgress("Installing OpenClaw (this may take a minute)...");
        setLogs("Installing OpenClaw (this may take a minute)...");
        if (!checks.openclaw) {
          await invoke("install_openclaw");
          const version: string = await invoke("get_openclaw_version");
          setOpenClawVersion(version);
        }

        setProgress("Configuring agent...");
        setLogs("Configuring...");

        await invoke("configure_agent", {
          config: {
            provider,
            api_key: apiKey,
            auth_method: authMethod,
            model,
            user_name: userName,
            agent_name: agentName,
            agent_vibe: agentVibe,
            telegram_token: telegramToken,
            gateway_port: gatewayPort,
            gateway_bind: gatewayBind,
            gateway_auth_mode: gatewayAuthMode,
            tailscale_mode: tailscaleMode,
            node_manager: nodeManager,
            skills: selectedSkills,
            service_keys: serviceKeys,
            // NEW: Advanced settings
            sandbox_mode: mode === "advanced" ? mappedSandboxMode : null,
            tools_mode: mode === "advanced" ? toolsMode : null,
            allowed_tools: mode === "advanced" && toolsMode === "allowlist" ? allowedTools : null,
            denied_tools: mode === "advanced" && toolsMode === "denylist" ? deniedTools : null,
            fallback_models: mode === "advanced" && enableFallbacks ? fallbackModels.filter(m => m) : null,
            heartbeat_mode: mode === "advanced" ? heartbeatMode : null,
            idle_timeout_ms: mode === "advanced" && heartbeatMode === "idle" ? idleTimeoutMs : null,
            identity_md: mode === "advanced" && identityMd ? identityMd : null,
            user_md: mode === "advanced" && userMd ? userMd : null,
            soul_md: mode === "advanced" && soulMd ? soulMd : null,
            // Multi-agent support
            agents: enableMultiAgent ? agentConfigs.map(a => ({
              id: a.id,
              name: a.name,
              model: a.model,
              fallback_models: a.fallbackModels.length > 0 ? a.fallbackModels : null,
              skills: a.skills.length > 0 ? a.skills : null,
              vibe: a.vibe,
              identity_md: a.identityMd || null,
              user_md: a.userMd || null,
              soul_md: a.soulMd || null
            })) : null,
            preserve_state: isPaired
          }
        });

        for (const skill of selectedSkills) {
          setProgress(`Installing skill: ${skill}...`);
          setLogs(`Installing skill: ${skill}...`);
          try {
            await invoke("install_skill", { name: skill });
          } catch (e) {
            console.error(`Failed to install skill ${skill}:`, e);
            setLogs(prev => prev + `\nWarning: Failed to install skill ${skill}: ${e}`);
          }
        }

        setProgress("Starting Gateway (this may take 20-30 seconds)...");
        setLogs("Starting Gateway...");
        await invoke("start_gateway");

        setProgress("Finalizing setup...");
        if (!isPaired) {
          const instruction: string = await invoke("generate_pairing_code");
          setPairingCode(instruction);
        }

        const url: string = await invoke("get_dashboard_url", {
          isRemote: false,
          remote: null
        });
        setDashboardUrl(url);

        setProgress("");
        setStep(17);
      }
    } catch (e) {
      setProgress("");
      setLogs("Error: " + e);
      setError(true);
    }
    setLoading(false);
  }

  async function handlePairing() {
    if (!pairingInput) return;
    setPairingStatus("Verifying...");
    try {
      const remoteConfig = targetEnvironment === "cloud" ? {
        ip: remoteIp,
        user: remoteUser,
        password: remotePassword || null,
        privateKeyPath: remotePrivateKeyPath || null
      } : null;

      await invoke("approve_pairing", {
        code: pairingInput,
        remote: remoteConfig
      });
      setPairingStatus("✅ Success! Bot paired.");
      setIsPaired(true);
      setPairingInput("");
    } catch (e) {
      setPairingStatus("❌ Error: " + e);
    }
  }

  async function handleMaintenanceAction(action: string) {
    setLoading(true);
    setMaintenanceStatus(`Running ${action}...`);
    setLogs(`Starting maintenance: ${action}...\n`);
    try {
      let res: string;

      // Build remote config if cloud environment
      const remoteConfig = targetEnvironment === "cloud" && sshStatus === "success" ? {
        ip: remoteIp,
        user: remoteUser,
        password: remotePassword || null,
        privateKeyPath: remotePrivateKeyPath || null
      } : null;

      if (action === "repair") {
        res = remoteConfig
          ? await invoke("run_remote_doctor_repair", { remote: remoteConfig })
          : await invoke("run_doctor_repair");
        setMaintenanceStatus(`✅ Repair completed successfully.`);
      } else if (action === "audit") {
        res = remoteConfig
          ? await invoke("run_remote_security_audit_fix", { remote: remoteConfig })
          : await invoke("run_security_audit_fix");
        setMaintenanceStatus(`✅ Security Audit completed successfully.`);
      } else if (action === "update") {
        if (remoteConfig) {
           res = await invoke("update_remote_openclaw", { remote: remoteConfig });
           setMaintenanceStatus(`✅ Remote OpenClaw updated.`);
        } else {
           res = await invoke("install_openclaw"); // Re-run install to update
           setMaintenanceStatus(`✅ OpenClaw updated.`);
        }
      } else {
        res = remoteConfig
          ? await invoke("uninstall_remote_openclaw", { remote: remoteConfig })
          : await invoke("uninstall_openclaw");
        // Reset everything after uninstall
        setChecks(prev => ({ ...prev, openclaw: false }));
        setMaintenanceStatus(`✅ Uninstall completed successfully.`);
      }
      setLogs(prev => prev + (res || ""));
      setMaintCompleted(true);
    } catch (e) {
      setLogs(prev => prev + `\nError: ${e}`);
      setMaintenanceStatus(`❌ ${action} failed.`);
    }
    setLoading(false);
  }

  async function handleToggleTunnel() {
    setLoading(true);
    if (tunnelActive) {
      try {
        await invoke("stop_ssh_tunnel");
        setTunnelActive(false);
        setMaintenanceStatus("✅ SSH Tunnel disconnected.");
      } catch (e) {
        setMaintenanceStatus(`❌ Failed to stop tunnel: ${e}`);
      }
    } else {
      setMaintenanceStatus("Establishing SSH tunnel...");
      try {
        const remote = { 
          ip: remoteIp, 
          user: remoteUser, 
          password: remotePassword || null, 
          privateKeyPath: remotePrivateKeyPath || null 
        };
        await invoke("start_ssh_tunnel", { remote });
        setTunnelActive(true);
        setMaintenanceStatus("✅ SSH Tunnel established on port 18789.");
      } catch (e) {
        setMaintenanceStatus(`❌ Failed to establish tunnel: ${e}`);
      }
    }
    setLoading(false);
  }

  const toggleSkill = (id: string) => {
    setSelectedSkills(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const getStepStatus = (stepId: number) => {
    if (step === stepId) return "active";
    if (step > stepId) return "completed";
    return "";
  };

  const isOAuthMethod = (method: string) => {
    return ["antigravity", "gemini_cli", "codex"].includes(method);
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="step-view">
            <h2>Welcome Back</h2>
            <p className="step-description">
              OpenClaw is already installed {targetEnvironment === "cloud" ? `on ${remoteIp}` : "on your system"}. What would you like to do?
            </p>

            {/* Quick Action Buttons */}
            <div className="button-group" style={{gap: "10px", marginBottom: "2rem"}}>
              <button
                className="primary"
                style={{flex: 1}}
                onClick={async () => {
                  try {
                    const url: string = await invoke("get_dashboard_url", {
                      isRemote: targetEnvironment === "cloud",
                      remote: targetEnvironment === "cloud" ? {
                        ip: remoteIp,
                        user: remoteUser,
                        password: remotePassword || null,
                        privateKeyPath: remotePrivateKeyPath || null
                      } : null
                    });
                    await open(url);
                  } catch (e) {
                    setMaintenanceStatus(`❌ Failed to get dashboard URL: ${e}`);
                  }
                }}
                disabled={targetEnvironment === "cloud" && !tunnelActive}
              >
                🌐 Open Dashboard
              </button>

              {targetEnvironment === "cloud" && (
                <button
                  className="secondary"
                  style={{flex: 1}}
                  onClick={async () => {
                    if (tunnelActive) {
                      // Stop tunnel
                      try {
                        await invoke("stop_ssh_tunnel");
                        setTunnelActive(false);
                        setMaintenanceStatus("✅ SSH tunnel stopped.");
                      } catch (e) {
                        setMaintenanceStatus(`❌ Failed to stop tunnel: ${e}`);
                      }
                    } else {
                      // Start tunnel - check if we have SSH config
                      if (!remoteIp || !remoteUser) {
                        setMaintenanceStatus("❌ SSH configuration missing. Please reconfigure to set up remote connection.");
                        return;
                      }

                      try {
                        // Test connection first if not already successful
                        if (sshStatus !== "success") {
                          setMaintenanceStatus("Testing SSH connection...");
                          await invoke("test_ssh_connection", {
                            remote: {
                              ip: remoteIp,
                              user: remoteUser,
                              password: remotePassword || null,
                              privateKeyPath: remotePrivateKeyPath || null
                            }
                          });
                          setSshStatus("success");
                        }

                        // Establish tunnel
                        setMaintenanceStatus("Establishing SSH tunnel...");
                        await invoke("start_ssh_tunnel", {
                          remote: {
                            ip: remoteIp,
                            user: remoteUser,
                            password: remotePassword || null,
                            privateKeyPath: remotePrivateKeyPath || null
                          }
                        });
                        setTunnelActive(true);
                        setMaintenanceStatus("✅ SSH tunnel established successfully. Dashboard is now accessible.");
                      } catch (e) {
                        const friendlyError = formatSshError(String(e));
                        setMaintenanceStatus(`❌ Failed to establish tunnel: ${friendlyError}`);
                        setSshStatus("idle");
                      }
                    }
                  }}
                >
                  {tunnelActive ? "🔓 Stop SSH Tunnel" : "🔒 Establish SSH Tunnel"}
                </button>
              )}
            </div>

            {/* Maintenance Options */}
            <h3 style={{marginBottom: "1rem"}}>Maintenance Options</h3>
            <div className="mode-card-container" style={{gridTemplateColumns: "1fr", gap: "1rem"}}>
              <div
                className={`mode-card ${selectedMaint === "repair" ? "active" : ""}`}
                onClick={() => !loading && setSelectedMaint("repair")}
              >
                <h3>🛠 Repair System</h3>
                <p>Run <code>openclaw doctor --repair</code> to fix configuration and service issues.</p>
              </div>

              <div
                className={`mode-card ${selectedMaint === "audit" ? "active" : ""}`}
                onClick={() => !loading && setSelectedMaint("audit")}
              >
                <h3>🛡 Security Audit</h3>
                <p>Run <code>openclaw security audit --fix</code> to audit and tighten system permissions.</p>
              </div>

              <div 
                className={`mode-card ${selectedMaint === "update" ? "active" : ""}`} 
                onClick={() => !loading && setSelectedMaint("update")}
              >
                <h3>🚀 Upgrade OpenClaw Version</h3>
                <p>Upgrade to the latest version of OpenClaw.</p>
              </div>

              <div
                className={`mode-card ${selectedMaint === "reconfigure" ? "active" : ""}`}
                onClick={() => !loading && setSelectedMaint("reconfigure")}
              >
                <h3>⚙️ Reconfigure OpenClaw</h3>
                <p>Proceed to the standard setup wizard to re-configure your agent and channels.</p>
              </div>

              <div
                className={`mode-card ${selectedMaint === "uninstall" ? "active" : ""}`}
                style={selectedMaint === "uninstall" ? {borderColor: "var(--error)", backgroundColor: "rgba(239, 68, 68, 0.05)"} : {}}
                onClick={() => !loading && setSelectedMaint("uninstall")}
              >
                <h3 style={selectedMaint === "uninstall" ? {color: "var(--error)"} : {}}>🗑 Uninstall Completely</h3>
                <p>Remove the OpenClaw CLI and all {targetEnvironment === "local" ? "local" : "remote"} configuration/data files.</p>
              </div>
            </div>

            {!loading && (
              <div className="button-group" style={{gap: "10px", marginTop: "1.5rem"}}>
                <button
                  className="primary"
                  style={{flex: 1}}
                  onClick={async () => {
                    if (selectedMaint === "reconfigure") {
                      // Go to Configuration Mode
                      setStep(3);
                    } else if (selectedMaint === "uninstall") {
                      if (confirm("Are you absolutely sure you want to completely remove OpenClaw and all its data?")) {
                        handleMaintenanceAction("uninstall");
                      }
                    } else if (selectedMaint) {
                      handleMaintenanceAction(selectedMaint);
                    }
                  }}
                  disabled={!selectedMaint}
                >
                  Confirm Action
                </button>
                {maintCompleted && (
                  <button className="secondary" style={{flex: 1}} onClick={() => invoke("close_app")}>Exit Setup</button>
                )}
              </div>
            )}

            {maintenanceStatus && (
              <div className="progress-container" style={{marginTop: "2rem"}}>
                <p style={{fontSize: "0.9rem", color: maintenanceStatus.includes("❌") ? "var(--error)" : maintenanceStatus.includes("✅") ? "var(--success)" : "var(--primary)"}}>{maintenanceStatus}</p>
                <div className="logs-container">
                  <pre>{logs}</pre>
                </div>
              </div>
            )}
          </div>
        );
      case 0.5:
        return (
          <div className="step-view welcome-view">
            <div className="welcome-logo">🦞</div>
            <h1 className="welcome-title">Welcome to ClawSetup</h1>
            <p className="welcome-text">
              The fastest way to deploy your AI agent. Get started in minutes.
            </p>
            <div className="button-group" style={{justifyContent: "center"}}>
              <button 
                className="primary" 
                style={{minWidth: "200px", padding: "1rem 2rem", fontSize: "1.1rem"}}
                onClick={() => setStep(1)}
              >
                Start Setup
              </button>
            </div>
          </div>
        );
      case 1:
        return (
          <div className="step-view">
            <h2>Target Environment</h2>
            <p className="step-description">Where will you be running OpenClaw?</p>
            <div className="mode-card-container">
              <div className={`mode-card ${targetEnvironment === "local" ? "active" : ""}`} onClick={() => {
                setTargetEnvironment("local");
                setSshStatus("idle");
              }}>
                <h3>💻 Local Machine</h3>
                <p>Run OpenClaw directly on your computer (macOS/Linux/Windows)</p>
              </div>
              <div className={`mode-card ${targetEnvironment === "cloud" ? "active" : ""}`} onClick={() => setTargetEnvironment("cloud")}>
                <h3>☁️ Cloud Server</h3>
                <p>Deploy to a cloud VM (AWS, GCP, Azure, etc.)</p>
              </div>
            </div>

            {targetEnvironment === "cloud" && (
              <div className="remote-config" style={{marginTop: "2rem"}}>
                <h3 style={{marginBottom: "1rem"}}>SSH Configuration</h3>
                <div className="form-group">
                  <label>Server IP Address</label>
                  <input
                    placeholder="192.168.1.100"
                    value={remoteIp}
                    onChange={(e) => setRemoteIp(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>SSH Username</label>
                  <input
                    placeholder="ubuntu"
                    value={remoteUser}
                    onChange={(e) => setRemoteUser(e.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </div>
                <div className="form-group">
                  <label>SSH Private Key (Optional)</label>
                  <div style={{display: "flex", gap: "0.5rem"}}>
                    <input
                      placeholder="/Users/you/.ssh/id_rsa"
                      value={remotePrivateKeyPath}
                      onChange={(e) => setRemotePrivateKeyPath(e.target.value)}
                      style={{flex: 1}}
                    />
                    <button
                      className="secondary"
                      onClick={async () => {
                        const path = await openDialog({
                          title: "Select SSH Private Key",
                          directory: false,
                          multiple: false,
                          defaultPath: "~/.ssh",
                        });
                        if (path && typeof path === "string") {
                          setRemotePrivateKeyPath(path);
                        }
                      }}
                    >
                      Browse
                    </button>
                  </div>
                  <p className="input-hint">Leave empty to use default keys (~/.ssh/id_rsa, id_ed25519) or SSH agent</p>
                </div>
                <div className="form-group">
                  <label>SSH Password (if not using key)</label>
                  <input
                    type="password"
                    placeholder="Password"
                    value={remotePassword}
                    onChange={(e) => setRemotePassword(e.target.value)}
                  />
                </div>

                <button
                  className="secondary"
                  onClick={handleSshCheck}
                  disabled={!remoteIp || !remoteUser || sshStatus === "checking"}
                  style={{width: "100%", marginTop: "1rem"}}
                >
                  {sshStatus === "checking" ? "Testing..." : "Test Connection"}
                </button>

                {sshStatus === "success" && (
                  <div style={{marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(34, 197, 94, 0.1)", borderRadius: "8px", border: "1px solid rgba(34, 197, 94, 0.3)"}}>
                    <strong style={{color: "rgb(34, 197, 94)"}}>✅ Success:</strong> <span style={{color: "var(--text)"}}>SSH connection established successfully!</span>
                  </div>
                )}

                {sshError && (
                  <div className="error" style={{marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.3)"}}>
                    <strong style={{color: "rgb(239, 68, 68)"}}>❌ Error:</strong> <span style={{color: "var(--text)"}}>{sshError}</span>
                  </div>
                )}
              </div>
            )}

            <div className="button-group" style={{marginTop: "2rem"}}>
              <button
                className="primary"
                onClick={async () => {
                  if (targetEnvironment === "cloud") {
                    const redirected = await checkRemoteSystem(false);
                    if (!redirected) {
                      setStep(2);
                    }
                  } else {
                    // Local environment - check local system and redirect if installed
                    const redirected = await checkSystem(false);
                    if (!redirected) {
                      setStep(2);
                    }
                  }
                }}
                disabled={targetEnvironment === "cloud" && sshStatus !== "success"}
              >
                Continue
              </button>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="step-view">
            <h2>System Check</h2>
            <p className="step-description">
              {targetEnvironment === "cloud"
                ? `Checking remote server (${remoteIp})...`
                : "We need to make sure your system is ready for OpenClaw."}
            </p>
            <div className="check-item">
              <span className="check-status">{checks.node ? "✅" : "❌"}</span>
              Node.js {checks.node ? "detected" : "not found"} {targetEnvironment === "cloud" && `(on ${remoteIp})`}
            </div>
            <div className="check-item">
              <span className="check-status">{checks.openclaw ? "✅" : "⏳"}</span>
              OpenClaw {checks.openclaw ? "Installed" : "Ready to install"} {targetEnvironment === "cloud" && `(on ${remoteIp})`}
            </div>
            {!checks.node && (
              <div className="error" style={{marginTop: "1rem", color: "var(--error)"}}>
                <p>Node.js is required.</p>
                {targetEnvironment === "local" && (
                   <div style={{display: "flex", gap: "10px", alignItems: "center", marginTop: "5px"}}>
                     <button
                       className="secondary small"
                       onClick={installLocalNode}
                       disabled={installingNode}
                       style={{padding: "4px 10px", fontSize: "0.8rem", cursor: "pointer"}}
                     >
                       {installingNode ? "Installing..." : "Install Now"}
                     </button>
                     {nodeInstallError && <span style={{fontSize: "0.8rem"}}>{nodeInstallError}</span>}
                   </div>
                )}
                {targetEnvironment === "cloud" && (
                   <p>It will be installed automatically in the Setup step.</p>
                )}
              </div>
            )}
            <div className="button-group">
              <button 
                className="primary" 
                disabled={targetEnvironment === "local" && !checks.node} 
                onClick={() => setStep(3)}
              >
                Continue
              </button>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="step-view">
            <h2>Security Baseline</h2>
            <p className="step-description">Please read this carefully before proceeding.</p>
            <div className="security-alert">
              <p>OpenClaw is a powerful agent system that can execute code and manage files.</p>
              <p>A malicious prompt could potentially trick the agent into performing unsafe actions. We recommend running it in a sandboxed environment if possible.</p>
              <p>Keep your API keys secure and never share your gateway token.</p>
            </div>
            <p style={{fontWeight: 600}}>Do you understand the risks and wish to continue?</p>
            <div className="button-group">
              <button className="primary" onClick={() => setStep(5)}>I Understand</button>
              <button className="secondary" onClick={() => setStep(2)}>Back</button>
            </div>
          </div>
        );
      case 5:
        return (
          <div className="step-view">
            <h2>Your Identity</h2>
            <p className="step-description">What should the agent call you?</p>
            <div className="form-group">
              <label>Your Name</label>
              <input 
                autoFocus 
                autoCapitalize="none" 
                autoCorrect="off" 
                spellCheck="false" 
                autoComplete="off" 
                placeholder="e.g. David" 
                value={userName} 
                onChange={(e) => setUserName(e.target.value)} 
              />
            </div>
            <div className="button-group">
              <button className="primary" disabled={!userName} onClick={() => setStep(6)}>Next</button>
              <button className="secondary" onClick={() => setStep(3)}>Back</button>
            </div>
          </div>
        );
      case 6:
        return (
          <div className="step-view">
            <h2>Agent Profile</h2>
            <p className="step-description">Give your agent a name and a personality.</p>
            <div className="form-group">
              <label>Agent Name</label>
              <input autoFocus placeholder="e.g. Jeeves" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Agent Vibe</label>
              <RadioCard
                value={agentVibe}
                onChange={setAgentVibe}
                columns={2}
                options={[
                  { value: "Professional", label: "Professional" },
                  { value: "Friendly", label: "Friendly" },
                  { value: "Chaos", label: "Chaos" },
                  { value: "Helpful Assistant", label: "Helpful Assistant" }
                ]}
              />
            </div>
            <div className="button-group">
              <button className="primary" disabled={!agentName} onClick={() => setStep(mode === "advanced" ? 7 : 8)}>Next</button>
              <button className="secondary" onClick={() => setStep(5)}>Back</button>
            </div>
          </div>
        );
      case 7:
        return (
          <div className="step-view">
            <h2>Gateway Settings</h2>
            <p className="step-description">Configure the network bridge for your agent.</p>
            <div className="form-group">
              <label>Port</label>
              <input type="number" value={gatewayPort} onChange={(e) => setGatewayPort(parseInt(e.target.value))} />
            </div>
            <div className="form-group">
              <label>Bind Address</label>
              <RadioCard
                value={gatewayBind}
                onChange={setGatewayBind}
                columns={2}
                options={[
                  { value: "loopback", label: "Loopback (127.0.0.1)", description: "Only accessible from this machine" },
                  { value: "all", label: "All Interfaces (0.0.0.0)", description: "Accessible from local network" }
                ]}
              />
            </div>
            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Auth Mode</label>
              <RadioCard
                value={gatewayAuthMode}
                onChange={setGatewayAuthMode}
                columns={2}
                options={[
                  { value: "token", label: "Token (Secure)", description: "Requires authentication token" },
                  { value: "none", label: "None (Insecure)", description: "No authentication required" }
                ]}
              />
            </div>
            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Tailscale</label>
              <RadioCard
                value={tailscaleMode}
                onChange={setTailscaleMode}
                columns={2}
                options={[
                  { value: "off", label: "Disabled", description: "Standard networking" },
                  { value: "on", label: "Enabled", description: "Expose securely via Tailscale" }
                ]}
              />
            </div>
            <div className="button-group">
              <button className="primary" onClick={() => {
                if (skipBasicConfig) {
                  setStep(10);
                } else {
                  setStep(8);
                }
              }}>Continue</button>
              <button className="secondary" onClick={() => setStep(6)}>Back</button>
            </div>
          </div>
        );
      case 8:
        return (
          <div className="step-view">
            <h2>Connect Brain</h2>
            <p className="step-description">Select your AI provider and authentication method.</p>
            
            <div className="form-group">
              <label>AI Provider</label>
              <div style={{maxHeight: "300px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem"}}>
                <RadioCard
                  value={provider}
                  onChange={(p) => {
                    setProvider(p);
                    if (MODELS_BY_PROVIDER[p] && MODELS_BY_PROVIDER[p].length > 0) {
                      setModel(MODELS_BY_PROVIDER[p][0].value);
                    }
                  }}
                  columns={2}
                  options={[
                    // Core providers
                    { value: "anthropic", label: "Anthropic", icon: PROVIDER_LOGOS["anthropic"] },
                    { value: "openai", label: "OpenAI", icon: PROVIDER_LOGOS["openai"] },
                    { value: "google", label: "Google Gemini", icon: PROVIDER_LOGOS["google"] },
                    { value: "openrouter", label: "OpenRouter", icon: PROVIDER_LOGOS["openrouter"] },
                    { value: "ollama", label: "Ollama (Local)", icon: PROVIDER_LOGOS["ollama"] },
                    // Others sorted alphabetically
                    ...Object.keys(MODELS_BY_PROVIDER)
                      .filter(p => !["anthropic", "openai", "google", "openrouter", "ollama"].includes(p))
                      .sort()
                      .map(p => ({
                        value: p,
                        label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                        icon: PROVIDER_LOGOS[p]
                      }))
                  ]}
                />
              </div>
            </div>
            
            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Auth Method</label>
              <RadioCard
                value={authMethod}
                onChange={setAuthMethod}
                columns={1}
                options={[
                  ...(provider === "anthropic" ? [
                    { value: "token", label: "Anthropic API Key", description: "Standard API Key starting with sk-ant-..." },
                    { value: "setup-token", label: "Anthropic Token (from setup-token)", description: "Temporary token from CLI setup" }
                  ] : []),
                  ...(provider === "google" ? [
                    { value: "token", label: "Google Gemini API Key", description: "Standard API Key" },
                    { value: "antigravity", label: "Google Antigravity OAuth", description: "Sign in with Google" },
                    { value: "gemini_cli", label: "Google Gemini CLI OAuth", description: "Sign in via CLI" }
                  ] : []),
                  ...(provider === "openai" ? [
                    { value: "token", label: "OpenAI API Key", description: "Standard API Key starting with sk-..." },
                    { value: "codex", label: "OpenAI Codex (ChatGPT OAuth)", description: "Sign in with OpenAI account" }
                  ] : []),
                  ...(!["anthropic", "google", "openai"].includes(provider) ? [
                     { value: "token", label: "API Key (Standard)", description: "Standard API Key for this provider" }
                  ] : [])
                ]}
              />
            </div>

            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Primary Model</label>
              {MODELS_BY_PROVIDER[provider] ? (
                 <div style={{maxHeight: "300px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem"}}>
                   <RadioCard
                     value={model}
                     onChange={setModel}
                     columns={1}
                     options={MODELS_BY_PROVIDER[provider].map(m => ({ value: m.value, label: m.label }))}
                   />
                 </div>
              ) : (
                <RadioCard
                   value={model}
                   onChange={setModel}
                   columns={1}
                   options={provider === "ollama" ? [
                     { value: "ollama/llama3.1", label: "Llama 3.1 (Local)" },
                     { value: "ollama/deepseek-r1", label: "DeepSeek R1 (Local)" }
                   ] : [
                     { value: model, label: model }
                   ]}
                />
              )}
            </div>

            {!isOAuthMethod(authMethod) && (
              <div className="form-group" style={{marginTop: "1.5rem"}}>
                <label>{authMethod === "setup-token" ? "Anthropic Setup Token" : "API Key"}</label>
                <input 
                  type="password" 
                  placeholder="Paste here..." 
                  value={apiKey} 
                  onChange={(e) => setApiKey(e.target.value)} 
                />
                {authMethod === "setup-token" && (
                  <p className="input-hint">
                    Run <code>claude setup-token</code> in your terminal and paste the result here.
                  </p>
                )}
              </div>
            )}

            {isOAuthMethod(authMethod) && (
              <div style={{marginTop: "1.5rem"}}>
                <button className="primary" style={{width: "100%"}} disabled={loading} onClick={async () => {
                  setLoading(true);
                  try {
                    const res: string = await invoke("start_provider_auth", { provider, method: authMethod });
                    setApiKey(res);
                  } catch (e) { 
                    setLogs("Auth Error: " + e);
                  }
                  setLoading(false);
                }}>
                  {loading ? "Waiting for Browser..." : "Launch Browser Login"}
                </button>
                <p className="input-hint">A browser window will open to complete the authentication.</p>
              </div>
            )}

            <div className="button-group">
              <button className="primary" disabled={!isOAuthMethod(authMethod) && !apiKey} onClick={() => setStep(9)}>Next</button>
              <button className="secondary" onClick={() => setStep(mode === "advanced" ? 7 : 6)}>Back</button>
            </div>
          </div>
        );
      case 9:
        return (
          <div className="step-view">
            <h2>Messaging Channels</h2>
            <p className="step-description">Connect your agent to Telegram for easy access.</p>
            <div className="form-group">
              <label>Telegram Bot Token</label>
              <input type="password" placeholder="123456:ABC-..." value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} />
              <p className="input-hint">Get one from @BotFather on Telegram.</p>
            </div>
            
            <div className="button-group">
              <button className="primary" onClick={() => {
                if (mode === "advanced") setStep(10);
                else handleInstall();
              }} disabled={loading}>
                {mode === "advanced" ? "Continue" : (loading ? "Installing..." : "Finish Setup")}
              </button>
              <button className="secondary" onClick={() => setStep(8)} disabled={loading}>Back</button>
            </div>
            
            {(loading || error) && (
              <div className="progress-container">
                {loading && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{width: progress.includes("Gateway") ? "80%" : (progress.includes("skill") ? "50%" : "20%")}} />
                  </div>
                )}
                <p style={{fontSize: "0.9rem", color: error ? "var(--error)" : "var(--primary)"}}>{error ? "Installation Failed" : progress}</p>
                <div className="logs-container">
                  <pre>{logs}</pre>
                </div>
              </div>
            )}
            
            {error && (
              <div style={{marginTop: "2rem"}}>
                <button className="primary" style={{backgroundColor: "var(--error)", width: "100%"}} onClick={() => invoke("close_app")}>Exit Installation</button>
              </div>
            )}
          </div>
        );
      case 10:
        return (
          <div className="step-view">
            <h2>Runtime Environment</h2>
            <p className="step-description">Configure how the agent executes tools and skills.</p>
            <div className="form-group">
              <label>Node Package Manager</label>
              <RadioCard
                value={nodeManager}
                onChange={setNodeManager}
                columns={3}
                options={[
                  { value: "npm", label: "npm" },
                  { value: "pnpm", label: "pnpm" },
                  { value: "bun", label: "bun" }
                ]}
              />
            </div>
            <div className="button-group">
              <button className="primary" onClick={() => setStep(10.5)}>Next</button>
              <button className="secondary" onClick={() => {
                if (skipBasicConfig) {
                  setStep(7);
                } else {
                  setStep(9);
                }
              }}>Back</button>
            </div>
          </div>
        );
      case 11:
        return (
          <div className="step-view">
            <h2>Select Skills</h2>
            <p className="step-description">Enable capabilities and configure required keys.</p>
            <div className="skills-container" style={{maxHeight: "450px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem"}}>
              <div className="skills-grid">
                {availableSkills.map(skill => (
                  <div
                    key={skill.id}
                    className={`skill-card ${selectedSkills.includes(skill.id) ? "active" : ""}`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).tagName === "INPUT") return;
                      toggleSkill(skill.id);
                    }}
                    style={{
                      cursor: "pointer", 
                      display: "flex", 
                      flexDirection: "column", 
                      gap: "0.5rem",
                      minHeight: "100px"
                    }}
                  >
                    <div className="skill-header" style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start"}}>
                      <div style={{display: "flex", alignItems: "center"}}>
                        {SKILL_ICONS[skill.id] && (
                          <img 
                            src={SKILL_ICONS[skill.id]} 
                            alt="" 
                            style={{
                              width: "20px", 
                              height: "20px", 
                              objectFit: "contain", 
                              borderRadius: "4px", 
                              backgroundColor: "white", 
                              padding: "2px",
                              marginRight: "8px"
                            }} 
                          />
                        )}
                        <div className="skill-name" style={{fontWeight: 700}}>{skill.name}</div>
                      </div>
                      <div className={`radio-circle ${selectedSkills.includes(skill.id) ? "checked" : ""}`} style={{
                        width: "18px",
                        height: "18px",
                        borderRadius: "50%",
                        border: `2px solid ${selectedSkills.includes(skill.id) ? "var(--primary)" : "var(--text-muted)"}`,
                        backgroundColor: selectedSkills.includes(skill.id) ? "var(--primary)" : "transparent",
                        flexShrink: 0
                      }} />
                    </div>
                    <div className="skill-desc" style={{fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.4"}}>{skill.desc}</div>
                    
                    {skill.requiresAuth && selectedSkills.includes(skill.id) && (
                      <div className="skill-auth" style={{marginTop: "auto", paddingTop: "0.5rem"}}>
                        <input
                          type="password"
                          placeholder={skill.authPlaceholder || "API Key"}
                          value={serviceKeys[skill.id] || ""}
                          onChange={(e) => setServiceKeys({...serviceKeys, [skill.id]: e.target.value})}
                          onClick={(e) => e.stopPropagation()}
                          style={{width: "100%", fontSize: "0.8rem", padding: "0.5rem", borderRadius: "8px"}}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{marginTop: "1.5rem"}}>
              <button className="secondary" onClick={() => setShowCustomSkillForm(!showCustomSkillForm)}>
                {showCustomSkillForm ? "Hide" : "+ Add"} Custom Skill
              </button>
            </div>

            {showCustomSkillForm && (
              <div className="custom-skill-form" style={{marginTop: "1.5rem"}}>
                <div className="form-group">
                  <label>Skill Name</label>
                  <input
                    placeholder="my-custom-skill"
                    value={customSkillName}
                    onChange={e => setCustomSkillName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Skill Content (YAML + Markdown)</label>
                  <textarea
                    className="markdown-editor"
                    rows={8}
                    value={customSkillContent}
                    onChange={e => setCustomSkillContent(e.target.value)}
                    placeholder={`---\nname: My Custom Skill\ndescription: A useful skill\n---\n\n# Instructions\nAdd skill documentation here...`}
                  />
                </div>
                <button
                  className="primary"
                  disabled={!customSkillName || !customSkillContent}
                  onClick={async () => {
                    try {
                      await invoke("create_custom_skill", { name: customSkillName, content: customSkillContent });
                      setSelectedSkills([...selectedSkills, customSkillName]);
                      setCustomSkillName("");
                      setCustomSkillContent("");
                      setShowCustomSkillForm(false);
                    } catch (e) {
                      alert("Failed to create skill: " + e);
                    }
                  }}
                >
                  Save Custom Skill
                </button>
              </div>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => {
                // Skip Step 11.5 as auth is handled inline
                if (mode === "advanced") {
                  setStep(12);
                } else {
                  handleInstall();
                }
              }}>Continue</button>
              <button className="secondary" onClick={() => setStep(10.5)}>Back</button>
            </div>
          </div>
        );
      case 11.5:
        return (
          <div className="step-view">
            <h2>Service Key: {servicesToConfigure[currentServiceIdx].name}</h2>
            <p className="step-description">Would you like to provide a key for this optional service now?</p>
            
            <div style={{marginBottom: "2rem"}}>
              <RadioCard
                value={isConfiguringService === true ? "yes" : "no"}
                onChange={(val) => setIsConfiguringService(val === "yes")}
                columns={2}
                options={[
                  { value: "yes", label: "Yes", description: `Configure ${servicesToConfigure[currentServiceIdx].name} now.` },
                  { value: "no", label: "Skip", description: "I'll configure this later in the dashboard." }
                ]}
              />
            </div>

            {isConfiguringService === true && (
              <div className="form-group animate-fadeIn">
                <label>{servicesToConfigure[currentServiceIdx].name} API Key</label>
                <input 
                  type="password" 
                  autoFocus
                  placeholder={servicesToConfigure[currentServiceIdx].placeholder} 
                  value={serviceKeys[servicesToConfigure[currentServiceIdx].id] || ""} 
                  onChange={(e) => setServiceKeys({...serviceKeys, [servicesToConfigure[currentServiceIdx].id]: e.target.value})} 
                />
              </div>
            )}

            <div className="button-group">
              <button
                className="primary"
                disabled={isConfiguringService === true && !serviceKeys[servicesToConfigure[currentServiceIdx].id]}
                onClick={() => {
                  const sid = servicesToConfigure[currentServiceIdx].id;
                  const newKeys = { ...serviceKeys };
                  if (!isConfiguringService) delete newKeys[sid];
                  setServiceKeys(newKeys);

                  if (currentServiceIdx < servicesToConfigure.length - 1) {
                    setCurrentServiceIdx(currentServiceIdx + 1);
                    setIsConfiguringService(false);
                  } else {
                    // After last service, go to Step 12 if advanced, otherwise install
                    if (mode === "advanced") {
                      setStep(12);
                    } else {
                      handleInstall();
                    }
                  }
                }}
              >
                {currentServiceIdx < servicesToConfigure.length - 1 ? "Next Service" : (mode === "advanced" ? "Continue to Advanced Settings" : (loading ? "Installing..." : "Finish Installation"))}
              </button>
              <button className="secondary" onClick={() => {
                if (currentServiceIdx > 0) {
                  setCurrentServiceIdx(currentServiceIdx - 1);
                  setIsConfiguringService(serviceKeys[servicesToConfigure[currentServiceIdx - 1].id] ? true : false);
                } else {
                  setStep(11);
                }
              }} disabled={loading}>Back</button>
            </div>
            {(loading || error) && (
               <div className="progress-container">
                  <p style={{fontSize: "0.9rem", color: error ? "var(--error)" : "var(--primary)"}}>{error ? "Installation Failed" : progress}</p>
                  <div className="logs-container">
                    <pre>{logs}</pre>
                  </div>
               </div>
            )}
            {error && (
              <div style={{marginTop: "2rem"}}>
                <button className="primary" style={{backgroundColor: "var(--error)", width: "100%"}} onClick={() => invoke("close_app")}>Exit Installation</button>
              </div>
            )}
          </div>
        );
      case 12:
        return (
          <div className="step-view">
            <h2>Security Configuration</h2>
            <p className="step-description">Configure security policies for your agent.</p>

            <div className="form-group">
              <label>Sandbox Mode</label>
              <RadioCard
                value={sandboxMode}
                onChange={setSandboxMode}
                columns={1}
                options={[
                  { value: "full", label: "Full Sandbox (Recommended)", description: "Maximum isolation for agent operations." },
                  { value: "partial", label: "Partial Sandbox", description: "Standard isolation." },
                  { value: "none", label: "No Sandbox", description: "Unrestricted access." }
                ]}
              />
            </div>

            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Tools Policy</label>
              <RadioCard
                value={toolsMode}
                onChange={setToolsMode}
                columns={1}
                options={[
                  { value: "allowlist", label: "Allowlist (Recommended)", description: "Only enable explicitly selected tools." },
                  { value: "denylist", label: "Denylist", description: "Block specific tools." },
                  { value: "all", label: "All Tools", description: "Enable all available tools." }
                ]}
              />
            </div>

            {toolsMode === "allowlist" && (
              <div className="form-group">
                <label>Allowed Tools</label>
                <div className="skills-grid">
                  {[
                    {id: "filesystem", name: "File System"},
                    {id: "terminal", name: "Terminal"},
                    {id: "browser", name: "Browser"},
                    {id: "network", name: "Network"}
                  ].map(tool => (
                    <div
                      key={tool.id}
                      className={`skill-card ${allowedTools.includes(tool.id) ? "active" : ""}`}
                      onClick={() => {
                        setAllowedTools(prev =>
                          prev.includes(tool.id)
                            ? prev.filter(t => t !== tool.id)
                            : [...prev, tool.id]
                        );
                      }}
                    >
                      <div className="skill-name">{tool.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => setStep(13)}>Continue</button>
              <button className="secondary" onClick={() => setStep(11.5)}>Back</button>
            </div>
          </div>
        );
      case 13:
        return (
          <div className="step-view">
            <h2>Fallback Models</h2>
            <p className="step-description">Configure backup models for increased reliability.</p>

            <div className="mode-card-container">
              <div className={`mode-card ${enableFallbacks ? "active" : ""}`} onClick={() => setEnableFallbacks(true)}>
                <h3>Enable Fallbacks</h3>
                <p>Chain multiple models for automatic failover.</p>
              </div>
              <div className={`mode-card ${!enableFallbacks ? "active" : ""}`} onClick={() => setEnableFallbacks(false)}>
                <h3>No Fallbacks</h3>
                <p>Use only the primary model.</p>
              </div>
            </div>

            {enableFallbacks && (
              <>
                {[0, 1].map(idx => {
                  const currentModel = fallbackModels[idx] || "";
                  const currentProvider = currentModel.split('/')[0];
                  const needsAuth = currentProvider && currentProvider !== provider && !serviceKeys[currentProvider];
                  
                  return (
                    <div key={idx} className="form-group" style={{marginTop: "1.5rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px"}}>
                      <label>Fallback Model {idx + 1} {idx === 1 && "(Optional)"}</label>
                      
                      {/* Provider Selection */}
                      <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Provider</label>
                      <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                        <RadioCard
                          value={currentProvider || ""}
                          onChange={(newProv) => {
                            if (!newProv) return;
                            // Set default model for this provider
                            if (MODELS_BY_PROVIDER[newProv] && MODELS_BY_PROVIDER[newProv].length > 0) {
                              const newModels = [...fallbackModels];
                              newModels[idx] = MODELS_BY_PROVIDER[newProv][0].value;
                              setFallbackModels(newModels);
                            }
                          }}
                          columns={2}
                          options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                            value: p,
                            label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                            icon: PROVIDER_LOGOS[p]
                          }))}
                        />
                      </div>

                      {/* Model Selection */}
                      {currentProvider && MODELS_BY_PROVIDER[currentProvider] && (
                        <>
                          <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Model</label>
                          <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                            <RadioCard
                              value={currentModel}
                              onChange={(val) => {
                                const newModels = [...fallbackModels];
                                newModels[idx] = val;
                                setFallbackModels(newModels);
                              }}
                              columns={1}
                              options={MODELS_BY_PROVIDER[currentProvider].map(m => ({ value: m.value, label: m.label }))}
                            />
                          </div>
                        </>
                      )}

                      {/* Auth Selection */}
                      {currentModel && currentProvider && currentProvider !== provider && !["ollama"].includes(currentProvider) && (
                        <div style={{marginTop: "0.5rem"}}>
                          <label style={{fontSize: "0.85rem", color: "var(--text-muted)"}}>API Key for {currentProvider}</label>
                          <input
                            type="password"
                            placeholder={`API Key for ${currentProvider}`}
                            value={serviceKeys[currentProvider] || ""}
                            onChange={(e) => setServiceKeys({...serviceKeys, [currentProvider]: e.target.value})}
                            autoComplete="off"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => setStep(14)}>Continue</button>
              <button className="secondary" onClick={() => setStep(12)}>Back</button>
            </div>
          </div>
        );
      case 14:
        return (
          <div className="step-view">
            <h2>Session Management</h2>
            <p className="step-description">Control when the agent resets context to save costs.</p>

            <div className="mode-card-container" style={{gridTemplateColumns: "1fr 1fr"}}>
              {[
                {mode: "1h", label: "Hourly", desc: "Reset every hour"},
                {mode: "4h", label: "4 Hours", desc: "Reset every 4 hours"},
                {mode: "24h", label: "Daily", desc: "Reset once per day"},
                {mode: "idle", label: "Idle Timeout", desc: "Reset after inactivity"},
                {mode: "never", label: "Never", desc: "Manual reset only"}
              ].map(item => (
                <div
                  key={item.mode}
                  className={`mode-card ${heartbeatMode === item.mode ? "active" : ""}`}
                  onClick={() => setHeartbeatMode(item.mode)}
                >
                  <h3>{item.label}</h3>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>

            {heartbeatMode === "idle" && (
              <div className="form-group" style={{marginTop: "1.5rem"}}>
                <label>Idle Timeout (minutes)</label>
                <input
                  type="number"
                  value={idleTimeoutMs / 60000}
                  onChange={e => setIdleTimeoutMs(Number(e.target.value) * 60000)}
                  min="1"
                  max="1440"
                />
                <p className="input-hint">Agent will reset context after this many minutes of inactivity.</p>
              </div>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => setStep(15)}>Continue</button>
              <button className="secondary" onClick={() => setStep(13)}>Back</button>
            </div>
          </div>
        );
      case 15:
        return (
          <div className="step-view">
            <h2>Multiple Agents</h2>
            <p className="step-description">Configure multiple specialized agents with unique models and skills.</p>

            <div className="mode-card-container">
              <div className={`mode-card ${!enableMultiAgent ? "active" : ""}`} onClick={() => setEnableMultiAgent(false)}>
                <h3>Single Agent</h3>
                <p>Use one agent with the configured settings.</p>
              </div>
              <div className={`mode-card ${enableMultiAgent ? "active" : ""}`} onClick={() => setEnableMultiAgent(true)}>
                <h3>Multi-Agent</h3>
                <p>Configure multiple agents (2-5) with different configurations.</p>
              </div>
            </div>

            {enableMultiAgent && (
              <div className="form-group" style={{marginTop: "2rem"}}>
                <label>Number of Agents</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={numAgents}
                  onChange={(e) => {
                    const num = parseInt(e.target.value) || 1;
                    setNumAgents(Math.max(1, Math.min(5, num)));
                  }}
                  autoComplete="off"
                />
                <p className="input-hint">You can configure 1-5 specialized agents</p>
              </div>
            )}

            <div className="button-group">
              <button className="primary" onClick={() => {
                if (enableMultiAgent) {
                  // Initialize agent configs
                  const configs = Array.from({ length: numAgents }, (_, i) => ({
                    id: `agent-${i + 1}`,
                    name: `Agent ${i + 1}`,
                    model: model, // Default to main model
                    fallbackModels: [],
                    skills: [], // Start empty
                    vibe: agentVibe,
                    identityMd: "",
                    userMd: "",
                    soulMd: ""
                  }));
                  setAgentConfigs(configs);
                  setCurrentAgentConfigIdx(0);
                  setActiveWorkspaceTab("identity"); // Reset tab
                  setStep(15.5);
                } else {
                  handleInstall();
                }
              }} disabled={loading}>
                {enableMultiAgent ? "Continue" : (loading ? "Installing..." : "Finish Installation")}
              </button>
              <button className="secondary" onClick={() => setStep(14)} disabled={loading}>Back</button>
            </div>
          </div>
        );
      case 15.5:
        // Agent Configuration Loop
        if (!enableMultiAgent || currentAgentConfigIdx >= agentConfigs.length) {
          setStep(16);
          return null;
        }
        const currentAgent = agentConfigs[currentAgentConfigIdx];
        const currentAgentProvider = currentAgent.model.split('/')[0];

        return (
          <div className="step-view">
            <h2>Configure Agent {currentAgentConfigIdx + 1} of {agentConfigs.length}</h2>
            <p className="step-description">Set up the model, skills, and personality for {currentAgent.name || "this agent"}.</p>

            <div className="form-group">
              <label>Agent Name</label>
              <input
                value={currentAgent.name}
                onChange={(e) => {
                  const updated = [...agentConfigs];
                  updated[currentAgentConfigIdx].name = e.target.value;
                  setAgentConfigs(updated);
                }}
                placeholder="e.g., CodeBot"
                autoComplete="off"
              />
            </div>

            {/* Primary Model Config */}
            <div className="form-group" style={{padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "1rem"}}>
              <label>Primary Model</label>
              
              <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Provider</label>
              <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                <RadioCard
                   value={currentAgentProvider}
                   onChange={(newProv) => {
                     if (MODELS_BY_PROVIDER[newProv] && MODELS_BY_PROVIDER[newProv].length > 0) {
                       const updated = [...agentConfigs];
                       updated[currentAgentConfigIdx].model = MODELS_BY_PROVIDER[newProv][0].value;
                       setAgentConfigs(updated);
                     }
                   }}
                   columns={2}
                   options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                     value: p,
                     label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                     icon: PROVIDER_LOGOS[p]
                   }))}
                />
              </div>
              
              {currentAgentProvider && MODELS_BY_PROVIDER[currentAgentProvider] && (
                <>
                  <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Model</label>
                  <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                    <RadioCard
                       value={currentAgent.model}
                       onChange={(val) => {
                         const updated = [...agentConfigs];
                         updated[currentAgentConfigIdx].model = val;
                         setAgentConfigs(updated);
                       }}
                       columns={1}
                       options={MODELS_BY_PROVIDER[currentAgentProvider].map(m => ({ value: m.value, label: m.label }))}
                    />
                  </div>
                </>
              )}
              
              {/* Auth for Agent Primary */}
              {currentAgentProvider && currentAgentProvider !== provider && !serviceKeys[currentAgentProvider] && !["ollama"].includes(currentAgentProvider) && (
                 <div style={{marginTop: "0.5rem"}}>
                   <label style={{fontSize: "0.85rem", color: "var(--text-muted)"}}>API Key for {currentAgentProvider}</label>
                   <input
                     type="password"
                     placeholder={`API Key for ${currentAgentProvider}`}
                     value={serviceKeys[currentAgentProvider] || ""}
                     onChange={(e) => setServiceKeys({...serviceKeys, [currentAgentProvider]: e.target.value})}
                     autoComplete="off"
                   />
                 </div>
              )}
            </div>
            
            {/* Fallback for Agent */}
             <div className="form-group" style={{padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "1rem"}}>
               <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                 <label>Fallback Model (Optional)</label>
                 {currentAgent.fallbackModels[0] && (
                   <button className="secondary small" style={{padding: "2px 8px", fontSize: "0.75rem", height: "auto"}} onClick={() => {
                     const updated = [...agentConfigs];
                     updated[currentAgentConfigIdx].fallbackModels = [];
                     setAgentConfigs(updated);
                   }}>Clear</button>
                 )}
               </div>

               {(() => {
                 const currentFallbackModel = currentAgent.fallbackModels[0] || "";
                 const currentFallbackProvider = currentFallbackModel.split('/')[0];
                 
                 return (
                   <>
                     <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Provider</label>
                     <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                       <RadioCard
                         value={currentFallbackProvider || ""}
                         onChange={(newProv) => {
                           if (!newProv) return;
                           if (MODELS_BY_PROVIDER[newProv] && MODELS_BY_PROVIDER[newProv].length > 0) {
                             const updated = [...agentConfigs];
                             updated[currentAgentConfigIdx].fallbackModels = [MODELS_BY_PROVIDER[newProv][0].value];
                             setAgentConfigs(updated);
                           }
                         }}
                         columns={2}
                         options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                           value: p,
                           label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                           icon: PROVIDER_LOGOS[p]
                         }))}
                       />
                     </div>

                     {currentFallbackProvider && MODELS_BY_PROVIDER[currentFallbackProvider] && (
                       <>
                         <label style={{fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem"}}>Model</label>
                         <div style={{maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem", marginBottom: "1rem"}}>
                           <RadioCard
                             value={currentFallbackModel}
                             onChange={(val) => {
                               const updated = [...agentConfigs];
                               updated[currentAgentConfigIdx].fallbackModels = [val];
                               setAgentConfigs(updated);
                             }}
                             columns={1}
                             options={MODELS_BY_PROVIDER[currentFallbackProvider].map(m => ({ value: m.value, label: m.label }))}
                           />
                         </div>
                       </>
                     )}

                     {currentFallbackProvider && currentFallbackProvider !== provider && currentFallbackProvider !== currentAgentProvider && !serviceKeys[currentFallbackProvider] && !["ollama"].includes(currentFallbackProvider) && (
                       <div style={{marginTop: "0.5rem"}}>
                          <label style={{fontSize: "0.85rem", color: "var(--text-muted)"}}>API Key for {currentFallbackProvider}</label>
                          <input
                            type="password"
                            placeholder={`API Key for ${currentFallbackProvider}`}
                            value={serviceKeys[currentFallbackProvider] || ""}
                            onChange={(e) => setServiceKeys({...serviceKeys, [currentFallbackProvider]: e.target.value})}
                            autoComplete="off"
                          />
                       </div>
                     )}
                   </>
                 );
               })()}
             </div>

            <div className="form-group" style={{marginTop: "1.5rem"}}>
              <label>Agent Vibe</label>
              <RadioCard
                value={currentAgent.vibe}
                onChange={(val) => {
                  const updated = [...agentConfigs];
                  updated[currentAgentConfigIdx].vibe = val;
                  setAgentConfigs(updated);
                }}
                columns={2}
                options={[
                  { value: "Professional", label: "Professional" },
                  { value: "Friendly", label: "Friendly" },
                  { value: "Chaos", label: "Chaos" },
                  { value: "Helpful Assistant", label: "Helpful Assistant" }
                ]}
              />
            </div>

            <div className="form-group">
              <label>Skills</label>
              <div className="skills-grid" style={{marginTop: "0.5rem", maxHeight: "200px", overflowY: "auto"}}>
                {availableSkills.map(skill => (
                  <div
                    key={skill.id}
                    className={`skill-card ${currentAgent.skills.includes(skill.id) ? "active" : ""}`}
                    onClick={() => {
                      const updated = [...agentConfigs];
                      const skills = updated[currentAgentConfigIdx].skills;
                      if (skills.includes(skill.id)) {
                        updated[currentAgentConfigIdx].skills = skills.filter(s => s !== skill.id);
                      } else {
                        updated[currentAgentConfigIdx].skills.push(skill.id);
                      }
                      setAgentConfigs(updated);
                    }}
                    style={{padding: "0.75rem"}}
                  >
                    <div style={{display: "flex", alignItems: "center"}}>
                      {SKILL_ICONS[skill.id] && (
                        <img 
                          src={SKILL_ICONS[skill.id]} 
                          alt="" 
                          style={{
                            width: "16px", 
                            height: "16px", 
                            objectFit: "contain", 
                            borderRadius: "3px", 
                            backgroundColor: "white", 
                            padding: "1px", 
                            marginRight: "6px"
                          }} 
                        />
                      )}
                      <div className="skill-name" style={{fontSize: "0.85rem"}}>{skill.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Workspace Config */}
            <h3 style={{marginTop: "2rem"}}>Agent Workspace</h3>
            <div className="workspace-tabs">
              {[
                {id: "identity", label: "IDENTITY.md"},
                {id: "user", label: "USER.md"},
                {id: "soul", label: "SOUL.md"}
              ].map(tab => (
                <button
                  key={tab.id}
                  className={`tab ${activeWorkspaceTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="workspace-editor">
              {activeWorkspaceTab === "identity" && (
                <textarea
                  className="markdown-editor"
                  rows={8}
                  value={currentAgent.identityMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].identityMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# IDENTITY.md\n- **Name:** ${currentAgent.name}\n- **Vibe:** ${currentAgent.vibe}\n- **Emoji:** 🦞`}
                />
              )}
              {activeWorkspaceTab === "user" && (
                <textarea
                  className="markdown-editor"
                  rows={8}
                  value={currentAgent.userMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].userMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# USER.md\n- **Name:** ${userName}\n`}
                />
              )}
              {activeWorkspaceTab === "soul" && (
                <textarea
                  className="markdown-editor"
                  rows={8}
                  value={currentAgent.soulMd}
                  onChange={e => {
                    const updated = [...agentConfigs];
                    updated[currentAgentConfigIdx].soulMd = e.target.value;
                    setAgentConfigs(updated);
                  }}
                  placeholder={`# SOUL.md\n## Mission\nServe ${userName}.`}
                />
              )}
            </div>

            <div className="button-group" style={{marginTop: "1.5rem"}}>
              <button className="primary" onClick={() => {
                if (currentAgentConfigIdx < agentConfigs.length - 1) {
                  setCurrentAgentConfigIdx(currentAgentConfigIdx + 1);
                  setActiveWorkspaceTab("identity");
                } else {
                  handleInstall();
                }
              }} disabled={loading}>
                {currentAgentConfigIdx < agentConfigs.length - 1 ? "Next Agent" : (loading ? "Installing..." : "Finish Installation")}
              </button>
              <button className="secondary" onClick={() => {
                if (currentAgentConfigIdx > 0) {
                  setCurrentAgentConfigIdx(currentAgentConfigIdx - 1);
                  setActiveWorkspaceTab("identity");
                } else {
                  setStep(15);
                }
              }} disabled={loading}>Back</button>
            </div>
          </div>
        );

      case 10.5:
        return (
          <div className="step-view">
            <h2>Customize Workspace</h2>
            <p className="step-description">Edit your agent's identity, personality, and mission.</p>

            <div className="workspace-tabs">
              {[
                {id: "identity", label: "IDENTITY.md"},
                {id: "user", label: "USER.md"},
                {id: "soul", label: "SOUL.md"}
              ].map(tab => (
                <button
                  key={tab.id}
                  className={`tab ${activeWorkspaceTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="workspace-editor">
              {activeWorkspaceTab === "identity" && (
                <textarea
                  className="markdown-editor"
                  rows={12}
                  value={identityMd}
                  onChange={e => setIdentityMd(e.target.value)}
                  placeholder={`# IDENTITY.md - Who Am I?\n- **Name:** ${agentName}\n- **Vibe:** ${agentVibe}\n- **Emoji:** 🦞\n\nAdd more details about your agent's identity...`}
                />
              )}
              {activeWorkspaceTab === "user" && (
                <textarea
                  className="markdown-editor"
                  rows={12}
                  value={userMd}
                  onChange={e => setUserMd(e.target.value)}
                  placeholder={`# USER.md - About Your Human\n- **Name:** ${userName}\n\nAdd more details about yourself...`}
                />
              )}
              {activeWorkspaceTab === "soul" && (
                <textarea
                  className="markdown-editor"
                  rows={12}
                  value={soulMd}
                  onChange={e => setSoulMd(e.target.value)}
                  placeholder={`# SOUL.md\n## Mission\nServe ${userName}.\n\nAdd your agent's mission statement and guiding principles...`}
                />
              )}
            </div>

            <p className="input-hint" style={{marginTop: "1rem"}}>
              Leave blank to use auto-generated defaults. Changes can be edited later in the workspace folder.
            </p>

            <div className="button-group" style={{gap: "0.5rem"}}>
              <button
                className="secondary"
                disabled={!workspaceModified || savingWorkspace}
                onClick={() => handleSaveWorkspace()}
                style={{flex: "0 0 auto", minWidth: "150px"}}
              >
                {savingWorkspace ? "Saving..." : "💾 Save Changes"}
              </button>
              <button className="primary" onClick={() => setStep(11)} style={{flex: 1}}>
                Next
              </button>
              <button className="secondary" onClick={() => setStep(10)} style={{flex: "0 0 auto"}}>Back</button>
            </div>
          </div>
        );
      case 17:
        return (
          <div className="step-view">
            <h2>Setup Complete! 🦞</h2>
            <p style={{fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem"}}>OpenClaw {openClawVersion}</p>
            <p className="step-description">
              OpenClaw is running {targetEnvironment === "cloud" ? `on ${remoteIp}` : "locally"} and ready for your commands.
            </p>

            {targetEnvironment === "cloud" && (
              <div style={{
                padding: "1rem",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                borderRadius: "8px",
                marginBottom: "1.5rem",
                border: "1px solid rgba(59, 130, 246, 0.3)"
              }}>
                <h4 style={{margin: "0 0 0.5rem 0", color: "var(--primary)"}}>
                  {tunnelActive ? "🔒 SSH Tunnel Active" : "⚠️ Tunnel Inactive"}
                </h4>
                <p style={{fontSize: "0.85rem", color: "var(--text-muted)", margin: 0}}>
                  {tunnelActive
                    ? `Remote gateway (${remoteIp}:18789) is forwarded to localhost:18789`
                    : "SSH tunnel is not active"}
                </p>
                {tunnelActive && (
                  <button
                    className="secondary"
                    style={{marginTop: "1rem", width: "100%"}}
                    onClick={async () => {
                      try {
                        await invoke("stop_ssh_tunnel");
                        setTunnelActive(false);
                      } catch (e) {
                        console.error("Failed to stop tunnel:", e);
                      }
                    }}
                  >
                    Stop SSH Tunnel
                  </button>
                )}
              </div>
            )}

            <div className="pairing-result">
               <h3>Telegram Pairing</h3>
               
               {isPaired ? (
                 <div style={{marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(34, 197, 94, 0.1)", borderRadius: "8px", border: "1px solid rgba(34, 197, 94, 0.3)"}}>
                    <strong style={{color: "rgb(34, 197, 94)"}}>✅ Telegram Paired</strong>
                    <p style={{marginTop: "0.5rem", fontSize: "0.9rem", color: "var(--text)"}}>Your agent is connected to Telegram.</p>
                 </div>
               ) : (
                 <>
                   <p style={{color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.5rem"}}>
                     Send any message to your bot to receive your code.
                   </p>
                   <div className="pairing-code-display">{pairingCode.includes("Ready") ? "READY" : pairingCode}</div>

                   {telegramToken && (
                     <div className="form-group" style={{marginTop: "2rem"}}>
                       <input
                         type="text"
                         placeholder="Enter code (e.g. 3RQ8EBFE)"
                         value={pairingInput}
                         onChange={(e) => setPairingInput(e.target.value.toUpperCase())}
                         style={{textAlign: "center", letterSpacing: "2px", fontWeight: "bold"}}
                       />
                       <button className="primary" style={{width: "100%", marginTop: "1rem"}} onClick={handlePairing} disabled={!pairingInput || pairingStatus === "Verifying..."}>
                         {pairingStatus === "Verifying..." ? "Verifying..." : "Pair Agent"}
                       </button>
                       {pairingStatus && (
                         <p style={{marginTop: "1rem", fontWeight: "bold", color: pairingStatus.includes("Error") ? "var(--error)" : "var(--success)"}}>
                           {pairingStatus}
                         </p>
                       )}
                     </div>
                   )}
                 </>
               )}

               {(pairingStatus.includes("Success") || isPaired) && (
                  <div className="advanced-setup-prompt" style={{marginTop: "2rem", padding: "1.5rem", backgroundColor: "rgba(59, 130, 246, 0.1)", borderRadius: "12px", border: "1px solid var(--primary)"}}>
                    <h3 style={{marginTop: 0, marginBottom: "0.5rem"}}>Configuration Complete</h3>
                    <p style={{marginBottom: "1.5rem"}}>Your agent is paired and ready. {mode !== "advanced" && "Would you like to configure advanced settings (Gateway, Skills, Security, Multi-Agent) now?"}</p>
                    <div className="button-group" style={{gap: "1rem"}}>
                       <button className="primary" onClick={() => open(dashboardUrl)}>
                         Open Web Dashboard
                       </button>
                       {mode !== "advanced" && (
                         <button className="secondary" onClick={() => {
                           setMode("advanced");
                           setPairingStatus("");
                           setSkipBasicConfig(true);
                           setStep(7);
                         }}>
                           Configure Advanced
                         </button>
                       )}
                       <button className="secondary" onClick={() => invoke("close_app")}>
                         Exit Setup
                       </button>
                    </div>
                  </div>
               )}
            </div>

            {(!pairingStatus.includes("Success") && !isPaired) && (
              <div className="button-group" style={{flexDirection: "column", gap: "10px"}}>
                <button className="primary" style={{width: "100%"}} onClick={() => open(dashboardUrl)}>
                  Open Web Dashboard {targetEnvironment === "cloud" && "(via Tunnel)"}
                </button>
                <button className="secondary" style={{width: "100%"}} onClick={() => invoke("close_app")}>Exit Setup</button>
              </div>
            )}
            <p style={{ marginTop: "2rem", fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "center" }}>
              Terminal access: <code>openclaw tui</code> {targetEnvironment === "cloud" && `(SSH to ${remoteIp})`}
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo">
          🦞 ClawSetup
        </div>
        <ul className="step-list">
          {stepsList
            .filter(s => !s.hidden)
            .filter(s => mode === "advanced" || !s.advanced)
            .filter(s => !skipBasicConfig || (s.id !== 8 && s.id !== 9))
            .map((s, idx) => (
              <li key={s.id} className={`step-indicator ${getStepStatus(s.id)}`}>
                <span className="step-number">{idx + 1}</span>
                {s.name}
              </li>
            ))}
        </ul>
        <div style={{marginTop: "auto", paddingTop: "1rem"}}>
          <button 
            className="secondary" 
            style={{width: "100%", justifyContent: "space-between", padding: "0.5rem 1rem"}}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <span style={{fontSize: "0.85rem"}}>Theme</span>
            <span>{theme === "dark" ? "🌙" : "☀️"}</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="content-wrapper">
          {renderStep()}
        </div>
      </main>
    </div>
  );
}

export default App;
