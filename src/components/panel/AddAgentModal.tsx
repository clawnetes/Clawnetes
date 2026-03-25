import { memo, useState } from "react";
import type { AgentConfigData, ToolPolicy, ProviderAuthConfig } from "../../types";
import { AGENT_TYPE_PRESETS } from "../../presets/agentPresets";
import TabBar from "../ui/TabBar";

type AddAgentTab = "identity" | "model" | "skills" | "tools" | "heartbeat" | "advanced";

interface AddAgentModalProps {
  onClose: () => void;
  onSubmit: (agent: AgentConfigData) => void | Promise<void>;
}

// Default values for a new agent
const defaultFormState = {
  id: `agent-${Date.now()}`,
  name: "New Agent",
  emoji: "🤖",
  model: "anthropic/claude-opus-4-6",
  provider: "anthropic",
  fallbackModels: [] as string[],
  skills: [] as string[],
  vibe: "helpful assistant 🤖",
  identityMd: "",
  userMd: "",
  soulMd: "",
  heartbeatMode: "never" as string,
  idleTimeoutMs: 0,
  heartbeatMd: "",
  memoryMd: "",
  memoryEnabled: false,
  toolsMd: "",
  agentsMd: "",
  toolPolicy: {
    profile: "minimal" as const,
    allow: [],
    deny: [],
  } as ToolPolicy,
  cronJobs: [],
};

const MODAL_TABS: { id: AddAgentTab; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "model", label: "Model" },
  { id: "skills", label: "Skills" },
  { id: "tools", label: "Tools" },
  { id: "heartbeat", label: "Heartbeat" },
  { id: "advanced", label: "Advanced" },
];

const HEARTBEAT_PRESETS = [
  { value: "never", label: "Never" },
  { value: "30m", label: "Every 30 minutes" },
  { value: "1h", label: "Every hour" },
  { value: "6h", label: "Every 6 hours" },
  { value: "idle", label: "When idle" },
];

function AddAgentModal({ onClose, onSubmit }: AddAgentModalProps) {
  const [activeTab, setActiveTab] = useState<AddAgentTab>("identity");
  const [formState, setFormState] = useState(defaultFormState);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePresetSelect = (presetId: string) => {
    if (presetId === "blank") {
      setFormState(defaultFormState);
    } else {
      const preset = Object.values(AGENT_TYPE_PRESETS).find((p) => p.id === presetId);
      if (preset) {
        setFormState({
          ...defaultFormState,
          model: preset.model,
          provider: preset.provider,
          fallbackModels: preset.fallbackModels,
          skills: preset.skills,
          vibe: preset.description,
          heartbeatMode: preset.heartbeatMode,
          idleTimeoutMs: preset.idleTimeoutMs,
          toolPolicy: preset.toolPolicy,
          toolsMd: preset.toolsMd,
          agentsMd: preset.agentsMd,
          heartbeatMd: preset.heartbeatMd,
          memoryMd: preset.memoryMd,
          memoryEnabled: preset.memoryEnabled,
        });
      }
    }
    setSelectedPreset(presetId);
  };

  const handleInputChange = <K extends keyof typeof formState>(
    key: K,
    value: typeof formState[K]
  ) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddFallbackModel = () => {
    setFormState((prev) => ({
      ...prev,
      fallbackModels: [...prev.fallbackModels, ""],
    }));
  };

  const handleRemoveFallbackModel = (index: number) => {
    setFormState((prev) => ({
      ...prev,
      fallbackModels: prev.fallbackModels.filter((_, i) => i !== index),
    }));
  };

  const handleToggleSkill = (skillId: string) => {
    setFormState((prev) => {
      const skills = new Set(prev.skills);
      if (skills.has(skillId)) {
        skills.delete(skillId);
      } else {
        skills.add(skillId);
      }
      return { ...prev, skills: Array.from(skills) };
    });
  };

  const isValid = formState.name.trim().length > 0 && formState.model.length > 0;

  const handleSubmit = async () => {
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      await onSubmit(formState as AgentConfigData);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderIdentityTab = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          Agent Name *
        </label>
        <input
          type="text"
          value={formState.name}
          onChange={(e) => handleInputChange("name", e.target.value)}
          placeholder="e.g., Coding Assistant"
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          Emoji
        </label>
        <input
          type="text"
          value={formState.emoji}
          onChange={(e) => handleInputChange("emoji", e.target.value)}
          placeholder="🤖"
          maxLength={2}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-2">
          Quick-fill Preset (optional)
        </label>
        <div className="space-y-2">
          {[
            ...Object.values(AGENT_TYPE_PRESETS),
            { id: "blank", name: "Blank Agent" } as any,
          ].map((preset) => (
            <label key={preset.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="preset"
                checked={selectedPreset === preset.id}
                onChange={() => handlePresetSelect(preset.id)}
                className="rounded-full"
              />
              <span className="text-sm text-[var(--text-main)]">
                {preset.id === "blank" ? preset.name : preset.name}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          IDENTITY.md
        </label>
        <textarea
          value={formState.identityMd}
          onChange={(e) => handleInputChange("identityMd", e.target.value)}
          placeholder="# IDENTITY.md&#10;Agent identity and character..."
          rows={5}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)] font-mono text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          SOUL.md
        </label>
        <textarea
          value={formState.soulMd}
          onChange={(e) => handleInputChange("soulMd", e.target.value)}
          placeholder="# SOUL.md&#10;Persona, tone, boundaries..."
          rows={4}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)] font-mono text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          USER.md
        </label>
        <textarea
          value={formState.userMd}
          onChange={(e) => handleInputChange("userMd", e.target.value)}
          placeholder="# USER.md&#10;User profile and context..."
          rows={4}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)] font-mono text-sm"
        />
      </div>
    </div>
  );

  const renderModelTab = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          Provider
        </label>
        <select
          value={formState.provider}
          onChange={(e) => handleInputChange("provider", e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)]"
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama</option>
          <option value="lmstudio">LM Studio</option>
          <option value="local">Local</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          Primary Model *
        </label>
        <input
          type="text"
          value={formState.model}
          onChange={(e) => handleInputChange("model", e.target.value)}
          placeholder="e.g., anthropic/claude-opus-4-6"
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-[var(--text-main)]">
            Fallback Models
          </label>
          <button
            type="button"
            onClick={handleAddFallbackModel}
            className="text-xs px-2 py-1 rounded bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            + Add
          </button>
        </div>
        <div className="space-y-2">
          {formState.fallbackModels.map((model, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={model}
                onChange={(e) => {
                  const newFallbacks = [...formState.fallbackModels];
                  newFallbacks[index] = e.target.value;
                  handleInputChange("fallbackModels", newFallbacks);
                }}
                placeholder="e.g., anthropic/claude-sonnet-4-6"
                className="flex-1 px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)]"
              />
              <button
                type="button"
                onClick={() => handleRemoveFallbackModel(index)}
                className="px-2 py-1 rounded bg-red-600 text-white hover:opacity-90 text-sm"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderSkillsTab = () => (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-muted)]">Select skills for this agent</p>
      <div className="space-y-2">
        {[
          "github",
          "coding-agent",
          "web-search",
          "slack",
          "trello",
          "himalaya",
          "apple-notes",
          "apple-reminders",
          "goplaces",
          "local-places",
        ].map((skillId) => (
          <label key={skillId} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formState.skills.includes(skillId)}
              onChange={() => handleToggleSkill(skillId)}
              className="rounded"
            />
            <span className="text-sm text-[var(--text-main)]">{skillId}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const renderToolsTab = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          Tool Profile
        </label>
        <select
          value={formState.toolPolicy.profile || "minimal"}
          onChange={(e) =>
            handleInputChange("toolPolicy", {
              ...formState.toolPolicy,
              profile: e.target.value as any,
            })
          }
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)]"
        >
          <option value="minimal">Minimal</option>
          <option value="coding">Coding</option>
          <option value="messaging">Messaging</option>
          <option value="full">Full</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          TOOLS.md (Usage Instructions)
        </label>
        <textarea
          value={formState.toolsMd}
          onChange={(e) => handleInputChange("toolsMd", e.target.value)}
          placeholder="# TOOLS.md&#10;Tool usage guidance..."
          rows={4}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)] font-mono text-sm"
        />
      </div>
    </div>
  );

  const renderHeartbeatTab = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          Heartbeat Mode
        </label>
        <select
          value={formState.heartbeatMode}
          onChange={(e) => handleInputChange("heartbeatMode", e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)]"
        >
          {HEARTBEAT_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      {formState.heartbeatMode === "idle" && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
            Idle Timeout (ms)
          </label>
          <input
            type="number"
            value={formState.idleTimeoutMs}
            onChange={(e) =>
              handleInputChange("idleTimeoutMs", parseInt(e.target.value, 10))
            }
            placeholder="e.g., 60000"
            className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)]"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          HEARTBEAT.md
        </label>
        <textarea
          value={formState.heartbeatMd}
          onChange={(e) => handleInputChange("heartbeatMd", e.target.value)}
          placeholder="# HEARTBEAT.md&#10;Periodic checklist..."
          rows={4}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)] font-mono text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="memory-enabled"
          checked={formState.memoryEnabled}
          onChange={(e) => handleInputChange("memoryEnabled", e.target.checked)}
          className="rounded"
        />
        <label htmlFor="memory-enabled" className="text-sm text-[var(--text-main)]">
          Enable Memory
        </label>
      </div>

      {formState.memoryEnabled && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
            MEMORY.md
          </label>
          <textarea
            value={formState.memoryMd}
            onChange={(e) => handleInputChange("memoryMd", e.target.value)}
            placeholder="# MEMORY.md&#10;Long-term memory content..."
            rows={4}
            className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)] font-mono text-sm"
          />
        </div>
      )}
    </div>
  );

  const renderAdvancedTab = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--text-main)] mb-1">
          AGENTS.md
        </label>
        <textarea
          value={formState.agentsMd}
          onChange={(e) => handleInputChange("agentsMd", e.target.value)}
          placeholder="# AGENTS.md&#10;Sub-agent operating instructions..."
          rows={5}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--surface-border)] text-[var(--text-main)] placeholder:text-[var(--text-muted)] font-mono text-sm"
        />
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case "identity":
        return renderIdentityTab();
      case "model":
        return renderModelTab();
      case "skills":
        return renderSkillsTab();
      case "tools":
        return renderToolsTab();
      case "heartbeat":
        return renderHeartbeatTab();
      case "advanced":
        return renderAdvancedTab();
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[var(--surface-panel)] rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--surface-border)]">
          <h2 className="text-lg font-semibold text-[var(--text-main)]">Add New Agent</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <TabBar
          tabs={MODAL_TABS}
          activeTab={activeTab}
          onTabChange={(tabId) => setActiveTab(tabId as AddAgentTab)}
          className="px-6 pt-4 border-b border-[var(--surface-border)]"
        />

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderTabContent()}
        </div>

        {/* Modal Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-[var(--surface-border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md bg-[var(--surface-hover)] text-[var(--text-main)] hover:bg-[var(--surface-active)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
            className="ml-auto px-4 py-2 rounded-md bg-[var(--accent-primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {isSubmitting ? "Adding..." : "Add Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(AddAgentModal);
