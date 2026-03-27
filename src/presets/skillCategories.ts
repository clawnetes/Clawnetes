export interface SkillCategory {
  id: string;
  label: string;
  description: string;
  skills: string[];
}

export const SKILL_CATEGORIES: SkillCategory[] = [
  { id: "messaging", label: "Messaging", description: "Chat platforms and voice", skills: ["slack", "wacli", "imsg", "bluebubbles", "voice-call"] },
  { id: "email", label: "Email & Calendar", description: "Email and workspace tools", skills: ["himalaya", "gog"] },
  { id: "productivity", label: "Productivity", description: "Notes, tasks, and project management", skills: ["apple-notes", "apple-reminders", "bear-notes", "things-mac", "notion", "trello", "obsidian"] },
  { id: "development", label: "Development", description: "Code and DevOps tools", skills: ["github", "coding-agent", "skill-creator", "model-usage", "mcporter"] },
  { id: "ai", label: "AI & Generation", description: "AI models, image, and speech", skills: ["gemini", "openai-image-gen", "nano-banana-pro", "nano-pdf", "openai-whisper", "openai-whisper-api", "sherpa-onnx-tts"] },
  { id: "smart-home", label: "Smart Home", description: "Home automation and IoT", skills: ["openhue", "sonoscli", "blucli", "eightctl"] },
  { id: "media", label: "Media & Content", description: "Audio, video, and content", skills: ["blogwatcher", "camsnap", "gifgrep", "songsee", "spotify-player", "summarize", "video-frames"] },
  { id: "utilities", label: "Utilities", description: "Security, search, and system tools", skills: ["1password", "clawhub", "healthcheck", "goplaces", "local-places", "oracle", "ordercli", "session-logs", "weather", "peekaboo", "tmux", "sag"] },
  { id: "custom", label: "Custom", description: "User-added integrations", skills: [] },
];
