import { AgentConfigData, ToolPolicy } from "../types";

/**
 * View of editable agent config that works for both main and sub-agents.
 * Maps to either top-level wizard state or agentConfigs[i] depending on activeAgentId.
 */
export interface ActiveAgentView {
  model: string;
  fallbackModels: string[];
  skills: string[];
  vibe: string;
  emoji: string;
  identityMd: string;
  userMd: string;
  soulMd: string;
  toolsMd: string;
  agentsMd: string;
  heartbeatMd?: string;
  memoryMd?: string;
  heartbeatMode?: string;
  idleTimeoutMs?: number;
  memoryEnabled?: boolean;
  sandboxMode?: string;
  toolPolicy: ToolPolicy;
  provider?: string;
}

/**
 * Full app state shape needed for projection.
 * This is a minimal interface — it just needs the fields used by the helpers.
 */
export interface AppState {
  // Main agent state
  provider?: string;
  model: string;
  fallbackModels: string[];
  selectedSkills: string[];
  vibe: string;
  identityMd: string;
  userMd: string;
  soulMd: string;
  toolsMd: string;
  agentsMd: string;
  heartbeatMd?: string;
  memoryMd?: string;
  heartbeatMode?: string;
  idleTimeoutMs?: number;
  memoryEnabled?: boolean;
  sandboxMode?: string;
  toolPolicy: ToolPolicy;

  // Sub-agents
  agentConfigs: AgentConfigData[];
}

/**
 * Get the active agent's editable config view.
 * If activeAgentId is null or "main", returns main-agent top-level state.
 * Otherwise, returns the matching agent from agentConfigs[].
 */
export function getActiveAgentConfig(
  state: AppState,
  activeAgentId: string | null
): ActiveAgentView {
  // Default to main agent if no activeAgentId
  if (!activeAgentId || activeAgentId === "main") {
    return {
      model: state.model,
      fallbackModels: state.fallbackModels || [],
      skills: state.selectedSkills || [],
      vibe: state.vibe,
      emoji: state.vibe ? extractEmojiFromVibe(state.vibe) : "🤖",
      identityMd: state.identityMd,
      userMd: state.userMd,
      soulMd: state.soulMd,
      toolsMd: state.toolsMd,
      agentsMd: state.agentsMd,
      heartbeatMd: state.heartbeatMd || "",
      memoryMd: state.memoryMd || "",
      heartbeatMode: state.heartbeatMode || "never",
      idleTimeoutMs: state.idleTimeoutMs || 0,
      memoryEnabled: state.memoryEnabled || false,
      sandboxMode: state.sandboxMode,
      toolPolicy: state.toolPolicy,
      provider: state.provider,
    };
  }

  // Find matching sub-agent
  const agent = state.agentConfigs.find((a) => a.id === activeAgentId);
  if (!agent) {
    // Fallback to main if sub-agent not found
    return getActiveAgentConfig(state, "main");
  }

  return {
    model: agent.model,
    fallbackModels: agent.fallbackModels || [],
    skills: agent.skills || [],
    vibe: agent.vibe,
    emoji: agent.emoji,
    identityMd: agent.identityMd,
    userMd: agent.userMd,
    soulMd: agent.soulMd,
    toolsMd: agent.toolsMd,
    agentsMd: agent.agentsMd,
    heartbeatMd: agent.heartbeatMd || "",
    memoryMd: agent.memoryMd || "",
    heartbeatMode: agent.heartbeatMode || "never",
    idleTimeoutMs: agent.idleTimeoutMs || 0,
    memoryEnabled: agent.memoryEnabled || false,
    sandboxMode: agent.sandboxMode,
    toolPolicy: agent.toolPolicy,
    provider: agent.provider,
  };
}

/**
 * Apply a partial patch to the correct agent (main or sub-agent) in state.
 * Returns the partial state update that should be merged.
 */
export function patchAgentConfig(
  state: AppState,
  activeAgentId: string | null,
  patch: Partial<ActiveAgentView>
): Partial<AppState> {
  // Default to main agent if no activeAgentId
  if (!activeAgentId || activeAgentId === "main") {
    return {
      model: patch.model ?? state.model,
      fallbackModels: patch.fallbackModels ?? state.fallbackModels,
      selectedSkills: patch.skills ?? state.selectedSkills,
      vibe: patch.vibe ?? state.vibe,
      identityMd: patch.identityMd ?? state.identityMd,
      userMd: patch.userMd ?? state.userMd,
      soulMd: patch.soulMd ?? state.soulMd,
      toolsMd: patch.toolsMd ?? state.toolsMd,
      agentsMd: patch.agentsMd ?? state.agentsMd,
      heartbeatMd: patch.heartbeatMd ?? state.heartbeatMd,
      memoryMd: patch.memoryMd ?? state.memoryMd,
      heartbeatMode: patch.heartbeatMode ?? state.heartbeatMode,
      idleTimeoutMs:
        patch.idleTimeoutMs !== undefined ? patch.idleTimeoutMs : state.idleTimeoutMs,
      memoryEnabled:
        patch.memoryEnabled !== undefined ? patch.memoryEnabled : state.memoryEnabled,
      sandboxMode: patch.sandboxMode ?? state.sandboxMode,
      toolPolicy: patch.toolPolicy ?? state.toolPolicy,
      provider: patch.provider ?? state.provider,
    };
  }

  // Patch sub-agent in agentConfigs[]
  const agentIndex = state.agentConfigs.findIndex((a) => a.id === activeAgentId);
  if (agentIndex === -1) {
    // Fallback to main if sub-agent not found
    return patchAgentConfig(state, "main", patch);
  }

  const updatedAgent = {
    ...state.agentConfigs[agentIndex],
    model: patch.model ?? state.agentConfigs[agentIndex].model,
    fallbackModels: patch.fallbackModels ?? state.agentConfigs[agentIndex].fallbackModels,
    skills: patch.skills ?? state.agentConfigs[agentIndex].skills,
    vibe: patch.vibe ?? state.agentConfigs[agentIndex].vibe,
    emoji: patch.emoji ?? state.agentConfigs[agentIndex].emoji,
    identityMd: patch.identityMd ?? state.agentConfigs[agentIndex].identityMd,
    userMd: patch.userMd ?? state.agentConfigs[agentIndex].userMd,
    soulMd: patch.soulMd ?? state.agentConfigs[agentIndex].soulMd,
    toolsMd: patch.toolsMd ?? state.agentConfigs[agentIndex].toolsMd,
    agentsMd: patch.agentsMd ?? state.agentConfigs[agentIndex].agentsMd,
    heartbeatMd: patch.heartbeatMd ?? state.agentConfigs[agentIndex].heartbeatMd,
    memoryMd: patch.memoryMd ?? state.agentConfigs[agentIndex].memoryMd,
    heartbeatMode: patch.heartbeatMode ?? state.agentConfigs[agentIndex].heartbeatMode,
    idleTimeoutMs:
      patch.idleTimeoutMs !== undefined
        ? patch.idleTimeoutMs
        : state.agentConfigs[agentIndex].idleTimeoutMs,
    memoryEnabled:
      patch.memoryEnabled !== undefined
        ? patch.memoryEnabled
        : state.agentConfigs[agentIndex].memoryEnabled,
    sandboxMode: patch.sandboxMode ?? state.agentConfigs[agentIndex].sandboxMode,
    toolPolicy: patch.toolPolicy ?? state.agentConfigs[agentIndex].toolPolicy,
    provider: patch.provider ?? state.agentConfigs[agentIndex].provider,
  };

  const updatedConfigs = [...state.agentConfigs];
  updatedConfigs[agentIndex] = updatedAgent;

  return {
    agentConfigs: updatedConfigs,
  };
}

/**
 * Extract emoji from vibe string (assumes format like "helpful sloth 🦥").
 * Falls back to default emoji if not found.
 */
function extractEmojiFromVibe(vibe: string): string {
  const emojiMatch = vibe.match(/[\p{Emoji}]/gu);
  return emojiMatch ? emojiMatch[0] : "🤖";
}
