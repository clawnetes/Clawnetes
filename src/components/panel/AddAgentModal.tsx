import { memo, useMemo, useState } from "react";
import type { AgentConfigData, ProviderAuthConfig, ToolPolicy } from "../../types";
import { AGENT_TYPE_PRESETS } from "../../presets/agentPresets";
import { AVAILABLE_SKILLS } from "../../presets/availableSkills";
import {
  DEFAULT_MODELS,
  EMOJI_OPTIONS,
  MODELS_BY_PROVIDER,
  PROVIDER_LOGOS,
  SKILL_ICONS,
} from "../../presets/modelsByProvider";
import {
  OAUTH_METHODS_BY_PROVIDER,
  LOCAL_PROVIDERS,
  applyModelProviderAuth,
  createDefaultProviderAuth,
  getMissingReferencedProviders,
  getBaseProvider,
  getBaseProviderFromModel,
  getDefaultModelForProvider,
  getDisplayModelOptions,
  getProviderAuthOptions,
  isOAuthMethod,
} from "../../utils/providerAuth";
import { updateIdentityField, updateSoulMission } from "../../utils/markdownHelpers";
import { Badge, SearchInput } from "../ui";
import Dropdown from "../Dropdown";
import TabBar from "../ui/TabBar";
import ToolPolicyEditor from "../ToolPolicyEditor";
import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";

type AddAgentTab = "identity" | "model" | "skills" | "tools" | "heartbeat" | "advanced";

interface AddAgentModalProps {
  onClose: () => void;
  onSubmit: (agent: AgentConfigData) => void | Promise<void>;
  providerAuths?: Record<string, ProviderAuthConfig>;
  onProviderAuthChange?: (provider: string, auth: ProviderAuthConfig) => void | Promise<void>;
  onStartOAuth?: (
    provider: string,
    authMethod: string,
    oauthProviderId: string,
  ) => Promise<ProviderAuthConfig>;
  onDetectLocalModels?: (
    provider: "ollama" | "lmstudio" | "local",
    baseUrl?: string,
  ) => Promise<string[]>;
}

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

const DEFAULT_AGENT_NAME = "New Agent";
const DEFAULT_AGENT_EMOJI = "🤖";

function createDefaultFormState(): AgentConfigData {
  return {
    id: `agent-${Date.now()}`,
    name: DEFAULT_AGENT_NAME,
    emoji: DEFAULT_AGENT_EMOJI,
    model: "anthropic/claude-opus-4-6",
    provider: "anthropic",
    fallbackModels: [],
    skills: [],
    vibe: "",
    identityMd: "",
    userMd: "",
    soulMd: "",
    heartbeatMode: "never",
    idleTimeoutMs: 0,
    heartbeatMd: "",
    memoryMd: "",
    memoryEnabled: false,
    toolsMd: "",
    agentsMd: "",
    toolPolicy: {
      profile: "minimal",
      allow: [],
      deny: [],
    } as ToolPolicy,
    cronJobs: [],
  };
}

function cloneToolPolicy(policy: ToolPolicy): ToolPolicy {
  return {
    ...policy,
    allow: [...(policy.allow || [])],
    deny: [...(policy.deny || [])],
  };
}

function displayProviderName(provider: string) {
  if (!provider) return "";
  if (provider === "openai") return "OpenAI";
  if (provider === "lmstudio") return "LM Studio";
  return provider
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function providerAuthEqual(left: ProviderAuthConfig, right: ProviderAuthConfig) {
  return (
    left.auth_method === right.auth_method
    && left.token === right.token
    && left.profile_key === right.profile_key
    && left.oauth_provider_id === right.oauth_provider_id
  );
}

function remapAgentModels(
  state: AgentConfigData,
  auths: Record<string, ProviderAuthConfig>,
): AgentConfigData {
  return {
    ...state,
    model: applyModelProviderAuth(state.model, auths),
    fallbackModels: state.fallbackModels.map((modelRef) => applyModelProviderAuth(modelRef, auths)),
  };
}

function AddAgentModal({
  onClose,
  onSubmit,
  providerAuths = {},
  onProviderAuthChange,
  onStartOAuth,
  onDetectLocalModels,
}: AddAgentModalProps) {
  const [activeTab, setActiveTab] = useState<AddAgentTab>("identity");
  const [selectedPreset, setSelectedPreset] = useState<string>("blank");
  const [formState, setFormState] = useState<AgentConfigData>(createDefaultFormState);
  const [draftProviderAuths, setDraftProviderAuths] = useState<Record<string, ProviderAuthConfig>>(
    providerAuths,
  );
  const [skillSearch, setSkillSearch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localModels, setLocalModels] = useState<Record<"ollama" | "lmstudio" | "local", string[]>>({
    ollama: [],
    lmstudio: [],
    local: [],
  });
  const [detectingProviders, setDetectingProviders] = useState<Record<string, boolean>>({});
  const presetOptions = useMemo(
    () => [
      { value: "blank", label: "Blank Agent", description: "Start from an empty draft." },
      ...Object.values(AGENT_TYPE_PRESETS).map((preset) => ({
        value: preset.id,
        label: preset.name,
        description: preset.description,
        emoji: preset.emoji,
      })),
    ],
    [],
  );

  const emojiOptions = useMemo(
    () => EMOJI_OPTIONS.map((emoji) => ({ value: emoji, label: emoji })),
    [],
  );

  const providerOptions = useMemo(
    () =>
      Object.keys(MODELS_BY_PROVIDER)
        .sort()
        .map((provider) => ({
          value: provider,
          label: displayProviderName(provider),
          icon: PROVIDER_LOGOS[provider],
        })),
    [],
  );

  const filteredSkills = useMemo(() => {
    const query = skillSearch.trim().toLowerCase();
    if (!query) return AVAILABLE_SKILLS;
    return AVAILABLE_SKILLS.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query)
        || skill.desc.toLowerCase().includes(query)
        || skill.id.toLowerCase().includes(query),
    );
  }, [skillSearch]);

  const isValid = formState.name.trim().length > 0 && formState.model.length > 0;
  const nextFormState = useMemo(
    () => remapAgentModels(formState, draftProviderAuths),
    [draftProviderAuths, formState],
  );
  const missingReferencedProviders = useMemo(() => getMissingReferencedProviders({
    primaryModel: nextFormState.model,
    fallbackModels: nextFormState.fallbackModels,
    providerAuths: draftProviderAuths,
    options: {
      allowPendingOAuth: true,
      oauthHandlerAvailable: !!onStartOAuth,
    },
  }), [draftProviderAuths, nextFormState, onStartOAuth]);

  function getProviderAuth(provider: string) {
    return draftProviderAuths[provider] || createDefaultProviderAuth(provider);
  }

  function updateDraftProviderAuth(provider: string, nextAuth: ProviderAuthConfig) {
    const normalizedProvider = getBaseProvider(provider);
    const nextProviderAuths = {
      ...draftProviderAuths,
      [normalizedProvider]: nextAuth,
    };
    setDraftProviderAuths(nextProviderAuths);
    setFormState((prev) => remapAgentModels(prev, nextProviderAuths));
  }

  function updateField<K extends keyof AgentConfigData>(key: K, value: AgentConfigData[K]) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  function handleNameChange(value: string) {
    setFormState((prev) => ({
      ...prev,
      name: value,
      identityMd: prev.identityMd ? updateIdentityField(prev.identityMd, "Name", value) : prev.identityMd,
      soulMd: prev.soulMd ? updateSoulMission(prev.soulMd, value) : prev.soulMd,
    }));
  }

  function handleEmojiChange(value: string) {
    setFormState((prev) => ({
      ...prev,
      emoji: value,
      identityMd: prev.identityMd ? updateIdentityField(prev.identityMd, "Emoji", value) : prev.identityMd,
    }));
  }

  function handlePresetSelect(presetId: string) {
    if (presetId === "blank") {
      setFormState(createDefaultFormState());
      setSelectedPreset("blank");
      return;
    }

    const preset = Object.values(AGENT_TYPE_PRESETS).find((item) => item.id === presetId);
    const previousPreset =
      selectedPreset !== "blank"
        ? Object.values(AGENT_TYPE_PRESETS).find((item) => item.id === selectedPreset)
        : null;

    if (!preset) return;

    setFormState((prev) => {
      const keepName =
        !!prev.name.trim()
        && prev.name !== DEFAULT_AGENT_NAME
        && (!previousPreset || prev.name !== previousPreset.name);
      const keepEmoji =
        !!prev.emoji.trim()
        && prev.emoji !== DEFAULT_AGENT_EMOJI
        && (!previousPreset || prev.emoji !== previousPreset.emoji);

      const nextName = keepName ? prev.name : preset.name;
      const nextEmoji = keepEmoji ? prev.emoji : preset.emoji;
      const nextState = {
        ...createDefaultFormState(),
        name: nextName,
        emoji: nextEmoji,
        model: applyModelProviderAuth(preset.model, draftProviderAuths),
        provider: preset.provider,
        fallbackModels: [],
        skills: [...preset.skills],
        vibe: preset.description,
        identityMd: updateIdentityField(
          updateIdentityField(preset.identityMd, "Name", nextName),
          "Emoji",
          nextEmoji,
        ),
        userMd: "",
        soulMd: updateSoulMission(preset.soulMd, nextName),
        toolsMd: preset.toolsMd,
        agentsMd: preset.agentsMd,
        heartbeatMd: preset.heartbeatMd,
        memoryMd: preset.memoryMd,
        heartbeatMode: preset.heartbeatMode,
        idleTimeoutMs: preset.idleTimeoutMs,
        memoryEnabled: preset.memoryEnabled,
        sandboxMode: preset.sandboxMode,
        toolPolicy: cloneToolPolicy(preset.toolPolicy),
      } satisfies AgentConfigData;

      return nextState;
    });
    setSelectedPreset(presetId);
  }

  function getModelOptionsForProvider(provider: string) {
    if (!provider) return [];

    if (provider === "ollama" && localModels.ollama.length > 0) {
      return localModels.ollama.map((modelRef) => ({ value: `ollama/${modelRef}`, label: modelRef }));
    }
    if (provider === "lmstudio" && localModels.lmstudio.length > 0) {
      return localModels.lmstudio.map((modelRef) => ({ value: `lmstudio/${modelRef}`, label: modelRef }));
    }
    if (provider === "local" && localModels.local.length > 0) {
      return localModels.local.map((modelRef) => ({ value: `local/${modelRef}`, label: modelRef }));
    }

    return getDisplayModelOptions(provider, draftProviderAuths, MODELS_BY_PROVIDER);
  }

  function getDefaultModel(provider: string) {
    const defaultModel = getDefaultModelForProvider(provider, draftProviderAuths, DEFAULT_MODELS);
    if (defaultModel) return defaultModel;
    return getModelOptionsForProvider(provider)[0]?.value || "";
  }

  async function detectProviderModels(provider: "ollama" | "lmstudio" | "local") {
    if (!onDetectLocalModels) return;

    const baseUrl =
      provider === "lmstudio"
        ? "http://localhost:1234/v1"
        : provider === "local"
          ? "http://localhost:8080/v1"
          : undefined;

    setDetectingProviders((prev) => ({ ...prev, [provider]: true }));
    try {
      const models = await onDetectLocalModels(provider, baseUrl);
      setLocalModels((prev) => ({ ...prev, [provider]: models }));
      if (provider === formState.provider && models.length > 0) {
        updateField(
          "model",
          `${provider}/${models[0]}` as AgentConfigData["model"],
        );
      }
    } finally {
      setDetectingProviders((prev) => ({ ...prev, [provider]: false }));
    }
  }

  function toggleSkill(skillId: string) {
    setFormState((prev) => ({
      ...prev,
      skills: prev.skills.includes(skillId)
        ? prev.skills.filter((item) => item !== skillId)
        : [...prev.skills, skillId],
    }));
  }

  async function flushProviderAuthDrafts() {
    if (!onProviderAuthChange) return;

    const providerIds = Object.keys(draftProviderAuths);
    for (const provider of providerIds) {
      const baseProvider = getBaseProvider(provider);
      const nextAuth = draftProviderAuths[baseProvider];
      const currentAuth = providerAuths[baseProvider] || createDefaultProviderAuth(baseProvider);
      if (!nextAuth || providerAuthEqual(nextAuth, currentAuth)) continue;
      await onProviderAuthChange(baseProvider, nextAuth);
    }
  }

  function getPendingOAuthProviders(state: AgentConfigData) {
    const orderedProviders = [
      state.provider || getBaseProviderFromModel(state.model),
      ...state.fallbackModels.map((modelRef) => getBaseProviderFromModel(modelRef)),
    ];

    const seenProviders = new Set<string>();
    return orderedProviders.flatMap((provider) => {
      if (!provider || LOCAL_PROVIDERS.has(provider) || seenProviders.has(provider)) {
        return [];
      }
      seenProviders.add(provider);

      const auth = getProviderAuth(provider);
      const oauthProviderId =
        auth.oauth_provider_id
        || OAUTH_METHODS_BY_PROVIDER[provider]?.find((option) => option.value === auth.auth_method)?.oauthProviderId;

      if (!isOAuthMethod(auth.auth_method) || auth.profile_key || !oauthProviderId) {
        return [];
      }

      return [{
        provider,
        authMethod: auth.auth_method,
        oauthProviderId,
      }];
    });
  }

  async function handleSubmit() {
    if (!isValid || isSubmitting) return;
    if (missingReferencedProviders.length > 0) return;

    setIsSubmitting(true);
    try {
      const pendingOAuthProviders = getPendingOAuthProviders(nextFormState);
      await flushProviderAuthDrafts();
      await onSubmit(nextFormState);
      for (const item of pendingOAuthProviders) {
        if (!onStartOAuth) break;
        await onStartOAuth(item.provider, item.authMethod, item.oauthProviderId);
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderIdentityTab() {
    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
            <div className="form-group mb-0">
              <label htmlFor="add-agent-name">Agent Name</label>
              <input
                {...TEXT_ENTRY_PROPS}
                id="add-agent-name"
                type="text"
                value={formState.name}
                onChange={(event) => handleNameChange(event.target.value)}
                placeholder="e.g. Release Captain"
                className="w-full"
              />
            </div>
            <div className="form-group mb-0">
              <label>Emoji</label>
              <Dropdown
                value={formState.emoji}
                onChange={(value) => handleEmojiChange(value)}
                options={emojiOptions}
                testId="add-agent-emoji-dropdown"
              />
            </div>
          </div>

          <div className="form-group mt-4 mb-0">
            <label>Quick-Fill Preset</label>
            <Dropdown
              value={selectedPreset}
              onChange={handlePresetSelect}
              options={presetOptions}
              testId="add-agent-preset-dropdown"
            />
            <p className="input-hint">Apply a complete preset, then fine-tune the draft.</p>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm xl:col-span-2">
            <label htmlFor="add-agent-identity">IDENTITY.md</label>
            <textarea
              {...TEXT_ENTRY_PROPS}
              id="add-agent-identity"
              data-testid="add-agent-identity-md"
              className="markdown-editor min-h-[220px]"
              rows={10}
              value={formState.identityMd}
              onChange={(event) => updateField("identityMd", event.target.value)}
              placeholder="# IDENTITY.md&#10;Describe the agent's identity, role, and boundaries."
            />
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
            <label htmlFor="add-agent-soul">SOUL.md</label>
            <textarea
              {...TEXT_ENTRY_PROPS}
              id="add-agent-soul"
              data-testid="add-agent-soul-md"
              className="markdown-editor min-h-[220px]"
              rows={9}
              value={formState.soulMd}
              onChange={(event) => updateField("soulMd", event.target.value)}
              placeholder="# SOUL.md&#10;Mission, communication style, and core principles."
            />
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
            <label htmlFor="add-agent-user">USER.md</label>
            <textarea
              {...TEXT_ENTRY_PROPS}
              id="add-agent-user"
              data-testid="add-agent-user-md"
              className="markdown-editor min-h-[220px]"
              rows={9}
              value={formState.userMd}
              onChange={(event) => updateField("userMd", event.target.value)}
              placeholder="# USER.md&#10;Optional user-specific context for this agent."
            />
          </div>
        </section>
      </div>
    );
  }

  function renderProviderAuthEditor(provider: string) {
    const auth = getProviderAuth(provider);
    const authOptions = getProviderAuthOptions(provider);
    const selectedAuthOption = authOptions.find((option) => option.value === auth.auth_method);
    const connected = isOAuthMethod(auth.auth_method) ? !!auth.profile_key : !!auth.token;

    return (
      <div
        key={provider}
        className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm"
        data-testid={`add-agent-provider-auth-${provider}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-main)]">{displayProviderName(provider)}</h4>
            {selectedAuthOption?.description && (
              <p className="input-hint mt-1">{selectedAuthOption.description}</p>
            )}
          </div>
          {connected ? <Badge variant="active">Connected</Badge> : <Badge variant="auth-required">Needs auth</Badge>}
        </div>

        {authOptions.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {authOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  const oauthOption = OAUTH_METHODS_BY_PROVIDER[provider]?.find(
                    (item) => item.value === option.value,
                  );
                  updateDraftProviderAuth(provider, {
                    ...auth,
                    auth_method: option.value,
                    oauth_provider_id: oauthOption?.oauthProviderId ?? null,
                    token: isOAuthMethod(option.value) ? "" : auth.token,
                    profile_key: isOAuthMethod(option.value) ? auth.profile_key : null,
                    profile: isOAuthMethod(option.value) ? auth.profile : null,
                  });
                }}
                className={`px-2.5 py-1.5 rounded-md border text-[0.72rem] font-medium transition-colors ${
                  auth.auth_method === option.value
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                }`}
                data-testid={`add-agent-auth-method-${provider}-${option.value}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {(auth.auth_method === "token" || auth.auth_method === "setup-token") && (
          <div className="form-group mt-4 mb-0">
            <label>{provider === "google" ? "API Key" : "Credential"}</label>
            <input
              {...TEXT_ENTRY_PROPS}
              type="password"
              value={auth.token}
              onChange={(event) =>
                updateDraftProviderAuth(provider, {
                  ...auth,
                  token: event.target.value,
                })
              }
              placeholder={
                auth.auth_method === "setup-token"
                  ? "Paste `claude setup-token` output"
                  : provider === "google"
                    ? "Paste your Gemini API key"
                    : `Paste your ${displayProviderName(provider)} key`
              }
            />
          </div>
        )}

        {isOAuthMethod(auth.auth_method) && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Badge variant={auth.profile_key ? "active" : "neutral"}>
              {auth.profile_key ? "OAuth ready" : "OAuth after Add Agent"}
            </Badge>
            {auth.profile_key && (
              <span className="text-[0.72rem] text-[var(--text-muted)]">
                Imported profile: {auth.profile_key}
              </span>
            )}
            {!auth.profile_key && (
              <span
                className="text-[0.72rem] text-[var(--text-muted)]"
                data-testid={`add-agent-oauth-deferred-${provider}`}
              >
                OAuth will open after you click Add Agent.
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  function providerNeedsAuth(provider: string) {
    if (!provider || LOCAL_PROVIDERS.has(provider)) return false;
    const auth = getProviderAuth(provider);
    return isOAuthMethod(auth.auth_method) ? !auth.profile_key : !auth.token;
  }

  function shouldRenderInlineProviderAuth(provider: string, seenProviders: Set<string>) {
    return !!provider
      && !seenProviders.has(provider)
      && providerNeedsAuth(provider);
  }

  function renderModelTab() {
    const primaryProvider = formState.provider || getBaseProviderFromModel(formState.model);
    const primaryModelOptions = getModelOptionsForProvider(primaryProvider);
    const seenProviders = new Set<string>();
    const showPrimaryAuth = shouldRenderInlineProviderAuth(primaryProvider, seenProviders);
    if (primaryProvider && !LOCAL_PROVIDERS.has(primaryProvider)) {
      seenProviders.add(primaryProvider);
    }

    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-main)]">Primary Model</h3>
              <p className="input-hint mt-1">Choose the model this agent reaches for first.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="form-group mb-0">
              <label>Provider</label>
              <Dropdown
                value={primaryProvider}
                onChange={(provider) => {
                  updateField("provider", provider);
                  updateField("model", getDefaultModel(provider));
                }}
                options={providerOptions}
                testId="add-agent-primary-provider"
              />
            </div>
            <div className="form-group mb-0">
              <label>Model</label>
              <Dropdown
                value={formState.model}
                onChange={(value) => updateField("model", value)}
                searchable={primaryModelOptions.length > 10}
                options={primaryModelOptions}
                testId="add-agent-primary-model"
              />
            </div>
          </div>

          {LOCAL_PROVIDERS.has(primaryProvider) && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="secondary"
                disabled={!onDetectLocalModels || detectingProviders[primaryProvider]}
                onClick={() => void detectProviderModels(primaryProvider as "ollama" | "lmstudio" | "local")}
              >
                {detectingProviders[primaryProvider] ? "Detecting..." : "Detect Models"}
              </button>
              {getModelOptionsForProvider(primaryProvider).length > 0 && (
                <span className="text-[0.72rem] text-[var(--text-muted)]">
                  {getModelOptionsForProvider(primaryProvider).length} detected
                </span>
              )}
            </div>
          )}

          {showPrimaryAuth && (
            <div className="mt-4" data-testid={`add-agent-inline-auth-primary-${primaryProvider}`}>
              {renderProviderAuthEditor(primaryProvider)}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-main)]">Fallback Models</h3>
              <p className="input-hint mt-1">Add one or more fallback models for failover.</p>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => updateField("fallbackModels", [...formState.fallbackModels, ""])}
            >
              + Add fallback
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {formState.fallbackModels.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-5 text-sm text-[var(--text-muted)]">
                No fallback models configured yet.
              </div>
            )}

            {formState.fallbackModels.map((fallbackModel, index) => {
              const fallbackProvider = getBaseProviderFromModel(fallbackModel);
              const fallbackModelOptions = getModelOptionsForProvider(fallbackProvider);
              const showFallbackAuth = shouldRenderInlineProviderAuth(fallbackProvider, seenProviders);
              if (fallbackProvider && !LOCAL_PROVIDERS.has(fallbackProvider)) {
                seenProviders.add(fallbackProvider);
              }

              return (
                <div
                  key={`${fallbackModel || "empty"}-${index}`}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-[var(--text-main)]">
                      Fallback {index + 1}
                    </h4>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        updateField(
                          "fallbackModels",
                          formState.fallbackModels.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="form-group mb-0">
                      <label>Provider</label>
                      <Dropdown
                        value={fallbackProvider}
                        onChange={(provider) => {
                          const nextFallbacks = [...formState.fallbackModels];
                          nextFallbacks[index] = getDefaultModel(provider);
                          updateField("fallbackModels", nextFallbacks);
                        }}
                        options={providerOptions}
                        testId={`add-agent-fallback-provider-${index}`}
                      />
                    </div>
                    <div className="form-group mb-0">
                      <label>Model</label>
                      <Dropdown
                        value={fallbackModel}
                        onChange={(value) => {
                          const nextFallbacks = [...formState.fallbackModels];
                          nextFallbacks[index] = value;
                          updateField("fallbackModels", nextFallbacks);
                        }}
                        searchable={fallbackModelOptions.length > 10}
                        options={fallbackModelOptions}
                        placeholder={fallbackProvider ? "Select a model" : "Select a provider first"}
                        testId={`add-agent-fallback-model-${index}`}
                      />
                    </div>
                  </div>

                  {LOCAL_PROVIDERS.has(fallbackProvider) && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className="secondary"
                        disabled={!onDetectLocalModels || detectingProviders[fallbackProvider]}
                        onClick={() =>
                          void detectProviderModels(fallbackProvider as "ollama" | "lmstudio" | "local")
                        }
                      >
                        {detectingProviders[fallbackProvider] ? "Detecting..." : "Detect Models"}
                      </button>
                    </div>
                  )}

                  {showFallbackAuth && (
                    <div
                      className="mt-4"
                      data-testid={`add-agent-inline-auth-fallback-${index}-${fallbackProvider}`}
                    >
                      {renderProviderAuthEditor(fallbackProvider)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  function renderSkillsTab() {
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-main)]">Skills</h3>
              <p className="input-hint mt-1">Select the capabilities available to this agent.</p>
            </div>
            <div className="w-full md:w-[280px]">
              <SearchInput
                value={skillSearch}
                onChange={setSkillSearch}
                placeholder="Search skills..."
              />
            </div>
          </div>
        </section>

        <div className="skills-grid" data-testid="add-agent-skills-grid">
          {filteredSkills.map((skill) => {
            const selected = formState.skills.includes(skill.id);
            const icon = SKILL_ICONS[skill.id];

            return (
              <button
                key={skill.id}
                type="button"
                className={`skill-card w-full !justify-start !items-start text-left ${selected ? "active" : ""}`}
                onClick={() => toggleSkill(skill.id)}
                data-testid={`add-agent-skill-${skill.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {icon ? (
                      <img
                        src={icon}
                        alt=""
                        className="mt-0.5 h-6 w-6 rounded bg-white p-0.5 object-contain"
                      />
                    ) : (
                      <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded bg-[var(--surface-hover)] text-[0.72rem] font-bold text-[var(--text-main)]">
                        {skill.name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <div className="skill-name">{skill.name}</div>
                      <div className="skill-desc">{skill.desc}</div>
                    </div>
                  </div>
                  {selected && <Badge variant="active">Enabled</Badge>}
                </div>
                {skill.requiresAuth && (
                  <div className="mt-3">
                    <Badge variant="auth-required">
                      {skill.authMode === "oauth" ? "Uses global OAuth" : "Uses global key"}
                    </Badge>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderToolsTab() {
    return (
      <div className="space-y-4">
        <ToolPolicyEditor
          policy={formState.toolPolicy}
          onChange={(policy) => updateField("toolPolicy", policy)}
          title="Tool Access"
          description="Choose the agent's base tool profile, then enable or disable specific tools."
          showElevatedToggle
        />

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <label htmlFor="add-agent-tools-md">TOOLS.md</label>
          <textarea
            {...TEXT_ENTRY_PROPS}
            id="add-agent-tools-md"
            className="markdown-editor min-h-[220px]"
            rows={9}
            value={formState.toolsMd}
            onChange={(event) => updateField("toolsMd", event.target.value)}
            placeholder="# TOOLS.md&#10;Optional instructions for how this agent should use its tools."
          />
        </section>
      </div>
    );
  }

  function renderHeartbeatTab() {
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="form-group mb-0">
              <label>Heartbeat Mode</label>
              <Dropdown
                value={formState.heartbeatMode || "never"}
                onChange={(value) => updateField("heartbeatMode", value)}
                options={HEARTBEAT_PRESETS.map((preset) => ({
                  value: preset.value,
                  label: preset.label,
                }))}
                testId="add-agent-heartbeat-mode"
              />
            </div>
            {formState.heartbeatMode === "idle" && (
              <div className="form-group mb-0">
                <label>Idle Timeout (ms)</label>
                <input
                  type="number"
                  value={formState.idleTimeoutMs || 0}
                  onChange={(event) => updateField("idleTimeoutMs", Number(event.target.value) || 0)}
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-[var(--text-main)]">Memory</div>
              <div className="text-[0.72rem] text-[var(--text-muted)]">
                Keep agent-local memory instructions enabled for this draft.
              </div>
            </div>
            <button
              type="button"
              className={`tool-toggle ${formState.memoryEnabled ? "enabled" : ""}`}
              onClick={() => updateField("memoryEnabled", !formState.memoryEnabled)}
              aria-pressed={formState.memoryEnabled}
              aria-label="Toggle memory"
            >
              <span />
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <label htmlFor="add-agent-heartbeat-md">HEARTBEAT.md</label>
          <textarea
            {...TEXT_ENTRY_PROPS}
            id="add-agent-heartbeat-md"
            className="markdown-editor min-h-[200px]"
            rows={8}
            value={formState.heartbeatMd || ""}
            onChange={(event) => updateField("heartbeatMd", event.target.value)}
            placeholder="# HEARTBEAT.md&#10;Periodic checklist or routine for this agent."
          />
        </section>

        {formState.memoryEnabled && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
            <label htmlFor="add-agent-memory-md">MEMORY.md</label>
            <textarea
              {...TEXT_ENTRY_PROPS}
              id="add-agent-memory-md"
              className="markdown-editor min-h-[200px]"
              rows={8}
              value={formState.memoryMd || ""}
              onChange={(event) => updateField("memoryMd", event.target.value)}
              placeholder="# MEMORY.md&#10;Long-lived context this agent should retain."
            />
          </section>
        )}
      </div>
    );
  }

  function renderAdvancedTab() {
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <label htmlFor="add-agent-agents-md">AGENTS.md</label>
          <textarea
            {...TEXT_ENTRY_PROPS}
            id="add-agent-agents-md"
            className="markdown-editor min-h-[220px]"
            rows={9}
            value={formState.agentsMd}
            onChange={(event) => updateField("agentsMd", event.target.value)}
            placeholder="# AGENTS.md&#10;Sub-agent routing or delegation notes for this agent."
          />
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-main)]">Cron Jobs</h3>
              <p className="input-hint mt-1">Optional periodic jobs owned by this agent.</p>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                updateField("cronJobs", [
                  ...formState.cronJobs,
                  { name: "", schedule: "", command: "" },
                ])
              }
            >
              + Add cron
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {formState.cronJobs.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-5 text-sm text-[var(--text-muted)]">
                No cron jobs configured.
              </div>
            )}
            {formState.cronJobs.map((cron, index) => (
              <div key={`${cron.name}-${index}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-[var(--text-main)]">Job {index + 1}</h4>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      updateField(
                        "cronJobs",
                        formState.cronJobs.filter((_, cronIndex) => cronIndex !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="form-group mb-0">
                    <label>Name</label>
                    <input
                      {...TEXT_ENTRY_PROPS}
                      type="text"
                      value={cron.name}
                      onChange={(event) => {
                        const nextCronJobs = [...formState.cronJobs];
                        nextCronJobs[index] = { ...nextCronJobs[index], name: event.target.value };
                        updateField("cronJobs", nextCronJobs);
                      }}
                    />
                  </div>
                  <div className="form-group mb-0">
                    <label>Schedule</label>
                    <input
                      {...TEXT_ENTRY_PROPS}
                      type="text"
                      value={cron.schedule}
                      onChange={(event) => {
                        const nextCronJobs = [...formState.cronJobs];
                        nextCronJobs[index] = { ...nextCronJobs[index], schedule: event.target.value };
                        updateField("cronJobs", nextCronJobs);
                      }}
                      placeholder="0 9 * * *"
                    />
                  </div>
                </div>

                <div className="form-group mt-4 mb-0">
                  <label>Command</label>
                  <input
                    {...TEXT_ENTRY_PROPS}
                    type="text"
                    value={cron.command}
                    onChange={(event) => {
                      const nextCronJobs = [...formState.cronJobs];
                      nextCronJobs[index] = { ...nextCronJobs[index], command: event.target.value };
                      updateField("cronJobs", nextCronJobs);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderTabContent() {
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
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="w-full max-w-6xl overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--surface-panel)] shadow-2xl"
        style={{ height: "min(860px, calc(100vh - 2rem))" }}
        onClick={(event) => event.stopPropagation()}
        data-testid="add-agent-modal"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
            <div>
              <h2 className="mb-1 text-[1.35rem] font-semibold text-[var(--text-main)]">Add New Agent</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Build a complete draft agent with the same configuration depth as the setup flow.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
              aria-label="Close add agent modal"
            >
              ×
            </button>
          </div>

          <div className="border-b border-[var(--border)] px-6 pt-4">
            <TabBar
              tabs={MODAL_TABS}
              activeTab={activeTab}
              onTabChange={(tabId) => setActiveTab(tabId as AddAgentTab)}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5" data-testid={`add-agent-tab-${activeTab}`}>
            {renderTabContent()}
          </div>

          <div className="flex items-center gap-3 border-t border-[var(--border)] bg-[var(--surface-panel)] px-6 py-4">
            <div className="text-xs text-[var(--text-muted)]">
              Agent creation is committed when you click <span className="font-semibold text-[var(--text-main)]">Add Agent</span>.
              {missingReferencedProviders.length > 0 && (
                <span
                  className="block mt-1 text-[var(--error,#dc2626)]"
                  data-testid="add-agent-missing-provider-auth-error"
                >
                  Missing authentication for {missingReferencedProviders.join(", ")}.
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="secondary ml-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!isValid || isSubmitting || missingReferencedProviders.length > 0}
              className="primary"
            >
              {isSubmitting ? "Adding..." : "Add Agent"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(AddAgentModal);
