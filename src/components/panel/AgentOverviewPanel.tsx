import { memo, useState } from "react";
import type { AgentConfigData } from "../../types";
import { AGENT_TYPE_PRESETS } from "../../presets/agentPresets";
import { EMOJI_OPTIONS } from "../../presets/modelsByProvider";
import { updateIdentityField, updateSoulMission } from "../../utils/markdownHelpers";
import { Badge, ProviderLogo } from "../ui";
import { getBaseProviderFromModel } from "../../utils/providerAuth";
import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";

interface AgentOverviewPanelProps {
  agents: { id: string; name?: string }[];
  activeAgentId: string;
  onAgentSwitch: (agentId: string) => void;
  modelRef?: string;
  fallbackModels?: string[];
  skills?: string[];
  onAddAgent?: (agent: AgentConfigData) => void | Promise<void>;
}

type AgentPresetId = keyof typeof AGENT_TYPE_PRESETS;

const AGENT_PRESET_OPTIONS = Object.entries(AGENT_TYPE_PRESETS) as Array<
  [AgentPresetId, (typeof AGENT_TYPE_PRESETS)[AgentPresetId]]
>;
const DEFAULT_AGENT_TYPE = "coding-assistant" as AgentPresetId;

function buildAgentId(name: string, existingIds: string[]) {
  const baseId = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `agent-${existingIds.length + 1}`;

  let candidateId = baseId;
  let suffix = 2;
  while (existingIds.includes(candidateId)) {
    candidateId = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return candidateId;
}

function buildPresetAgent(
  presetId: AgentPresetId,
  name: string,
  emoji: string,
  existingIds: string[],
): AgentConfigData {
  const preset = AGENT_TYPE_PRESETS[presetId];
  const trimmedName = name.trim();

  return {
    id: buildAgentId(trimmedName, existingIds),
    name: trimmedName,
    model: preset.model,
    fallbackModels: [...preset.fallbackModels],
    skills: [...preset.skills],
    vibe: "",
    emoji,
    identityMd: updateIdentityField(
      updateIdentityField(preset.identityMd, "Name", trimmedName),
      "Emoji",
      emoji,
    ),
    userMd: "",
    soulMd: updateSoulMission(preset.soulMd, trimmedName),
    toolsMd: preset.toolsMd,
    agentsMd: preset.agentsMd,
    toolPolicy: {
      ...preset.toolPolicy,
      allow: [...preset.toolPolicy.allow],
      deny: [...preset.toolPolicy.deny],
    },
    cronJobs: [],
  };
}

function AgentOverviewPanel({
  agents,
  activeAgentId,
  onAgentSwitch,
  modelRef,
  fallbackModels = [],
  skills = [],
  onAddAgent,
}: AgentOverviewPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [selectedType, setSelectedType] = useState<AgentPresetId>(DEFAULT_AGENT_TYPE);
  const [draftName, setDraftName] = useState(AGENT_TYPE_PRESETS[DEFAULT_AGENT_TYPE].name);
  const [draftEmoji, setDraftEmoji] = useState(AGENT_TYPE_PRESETS[DEFAULT_AGENT_TYPE].emoji);
  const [submitting, setSubmitting] = useState(false);

  function resetForm(nextType: AgentPresetId = DEFAULT_AGENT_TYPE) {
    const preset = AGENT_TYPE_PRESETS[nextType];
    setSelectedType(nextType);
    setDraftName(preset.name);
    setDraftEmoji(preset.emoji);
    setSubmitting(false);
  }

  function handleToggleForm() {
    if (showForm) {
      resetForm();
      setShowForm(false);
      return;
    }

    resetForm();
    setShowForm(true);
  }

  function handleTypeChange(nextType: AgentPresetId) {
    const preset = AGENT_TYPE_PRESETS[nextType];
    const currentPresetNames = new Set(AGENT_PRESET_OPTIONS.map(([, option]) => option.name));

    setSelectedType(nextType);
    setDraftEmoji(preset.emoji);
    if (!draftName.trim() || currentPresetNames.has(draftName.trim())) {
      setDraftName(preset.name);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onAddAgent || submitting) return;

    const trimmedName = draftName.trim();
    if (!trimmedName) return;

    setSubmitting(true);
    try {
      await onAddAgent(
        buildPresetAgent(
          selectedType,
          trimmedName,
          draftEmoji,
          agents.map((agent) => agent.id),
        ),
      );
      resetForm();
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="agent-overview-panel">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--text-main)]">
          Agents
        </h4>
        <span className="text-[0.65rem] text-[var(--text-muted)]">
          {agents.length} {agents.length === 1 ? "agent" : "agents"}
        </span>
      </div>

      {agents.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center">
          No agents available.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {agents.map((agent) => {
          const isActive = agent.id === activeAgentId;
          const displayName = agent.name || agent.id;
          const provider = modelRef ? getBaseProviderFromModel(modelRef) : "";
          const modelName = modelRef ? modelRef.split("/").slice(1).join("/") : "";

          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onAgentSwitch(agent.id)}
              className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors duration-150 ${
                isActive
                  ? "bg-[var(--accent)]/10 border border-[var(--accent)]/30"
                  : "bg-[var(--surface-1)] border border-[var(--sidebar-border)] hover:bg-[var(--surface-hover)]"
              }`}
              data-testid={`agent-card-${agent.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-sm font-medium truncate ${
                    isActive ? "text-[var(--accent)]" : "text-[var(--text-main)]"
                  }`}
                >
                  {displayName}
                </span>
                {isActive && <Badge variant="accent">Active</Badge>}
              </div>

              {modelRef && isActive && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  {provider && <ProviderLogo provider={provider} size={14} />}
                  <span className="text-[0.7rem] text-[var(--text-muted)] truncate">
                    {modelName}
                  </span>
                </div>
              )}

              {isActive && skills.length > 0 && (
                <div className="mt-1.5">
                  <Badge variant="neutral">
                    {skills.length} {skills.length === 1 ? "skill" : "skills"}
                  </Badge>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {fallbackModels.length > 0 && (
        <div className="mt-1 px-1">
          <p className="text-[0.65rem] text-[var(--text-muted)]">
            {fallbackModels.length} fallback{" "}
            {fallbackModels.length === 1 ? "model" : "models"} configured
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={handleToggleForm}
        disabled={!onAddAgent || submitting}
        className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed text-xs transition-colors ${
          onAddAgent
            ? "border-[var(--sidebar-border)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--text-muted)]"
            : "border-[var(--sidebar-border)] text-[var(--text-muted)] opacity-60 cursor-not-allowed"
        }`}
        data-testid="add-agent-btn"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M8 3v10" />
          <path d="M3 8h10" />
        </svg>
        {showForm ? "Cancel" : "Add Agent"}
      </button>

      {showForm && onAddAgent && (
        <form
          className="flex flex-col gap-3 rounded-lg border border-[var(--sidebar-border)] bg-[var(--surface-1)] p-3"
          onSubmit={(event) => void handleSubmit(event)}
          data-testid="add-agent-form"
        >
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] font-medium text-[var(--text-subtle)]" htmlFor="agent-name">
              Name
            </label>
            <input
              {...TEXT_ENTRY_PROPS}
              id="agent-name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="rounded-md border border-[var(--sidebar-border)] bg-[var(--surface-panel)] px-2.5 py-2 text-sm text-[var(--text-main)]"
              placeholder="Agent name"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-medium text-[var(--text-subtle)]" htmlFor="agent-emoji">
                Emoji
              </label>
              <select
                id="agent-emoji"
                value={draftEmoji}
                onChange={(event) => setDraftEmoji(event.target.value)}
                className="rounded-md border border-[var(--sidebar-border)] bg-[var(--surface-panel)] px-2.5 py-2 text-sm text-[var(--text-main)]"
              >
                {EMOJI_OPTIONS.map((emoji) => (
                  <option key={emoji} value={emoji}>
                    {emoji}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] font-medium text-[var(--text-subtle)]" htmlFor="agent-type">
                Agent Type
              </label>
              <select
                id="agent-type"
                value={selectedType}
                onChange={(event) => handleTypeChange(event.target.value as AgentPresetId)}
                className="rounded-md border border-[var(--sidebar-border)] bg-[var(--surface-panel)] px-2.5 py-2 text-sm text-[var(--text-main)]"
              >
                {AGENT_PRESET_OPTIONS.map(([presetId, preset]) => (
                  <option key={presetId} value={presetId}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={!draftName.trim() || submitting}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? "Adding..." : "Create Agent"}
          </button>
        </form>
      )}
    </div>
  );
}

export default memo(AgentOverviewPanel);
