import type { ProviderAuthConfig, SkillOption } from "../types";

export const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "local"]);

export const OAUTH_METHODS_BY_PROVIDER: Record<string, Array<{ value: string; label: string; oauthProviderId: string }>> = {
  anthropic: [
    { value: "claude-cli", label: "Claude Code Setup Token", oauthProviderId: "anthropic" },
  ],
  openai: [
    { value: "openai-codex", label: "OpenAI Codex OAuth", oauthProviderId: "openai-codex" },
  ],
  google: [
    { value: "google-gemini-cli", label: "Gemini CLI OAuth", oauthProviderId: "google-gemini-cli" },
    { value: "google-antigravity", label: "Antigravity OAuth", oauthProviderId: "google-antigravity" },
  ],
};

const MODEL_PROVIDER_OVERRIDE_BY_AUTH_METHOD: Record<string, string> = {
  "openai-codex": "openai-codex",
};

const BASE_PROVIDER_BY_MODEL_PROVIDER: Record<string, string> = {
  "openai-codex": "openai",
};

export function getBaseProvider(provider: string): string {
  return BASE_PROVIDER_BY_MODEL_PROVIDER[provider] || provider;
}

export function getEffectiveModelProvider(provider: string, providerAuths: Record<string, ProviderAuthConfig>): string {
  const baseProvider = getBaseProvider(provider);
  const authMethod = providerAuths[baseProvider]?.auth_method;
  return authMethod ? (MODEL_PROVIDER_OVERRIDE_BY_AUTH_METHOD[authMethod] || baseProvider) : baseProvider;
}

export function applyModelProviderAuth(modelRef: string, providerAuths: Record<string, ProviderAuthConfig>): string {
  if (!modelRef || !modelRef.includes("/")) return modelRef;
  const [provider, ...rest] = modelRef.split("/");
  const effectiveProvider = getEffectiveModelProvider(provider, providerAuths);
  if (effectiveProvider === provider) return modelRef;
  return `${effectiveProvider}/${rest.join("/")}`;
}

export function getBaseProviderFromModel(modelRef: string): string {
  if (!modelRef || !modelRef.includes("/")) return modelRef;
  return getBaseProvider(modelRef.split("/")[0]);
}

export function normalizeModelRefForUi(modelRef: string, providerAuths?: Record<string, ProviderAuthConfig>): string {
  if (!modelRef || !modelRef.includes("/")) return modelRef;
  if (providerAuths) {
    return applyModelProviderAuth(modelRef, providerAuths);
  }
  const [provider, ...rest] = modelRef.split("/");
  return `${getBaseProvider(provider)}/${rest.join("/")}`;
}

export function getDisplayModelOptions(
  provider: string,
  providerAuths: Record<string, ProviderAuthConfig>,
  modelsByProvider: Record<string, Array<{ value: string; label: string; description?: string }>>,
): Array<{ value: string; label: string; description?: string }> {
  const effectiveProvider = getEffectiveModelProvider(provider, providerAuths);
  const showExplicitNamespace = effectiveProvider !== provider;

  return (modelsByProvider[provider] || []).map((model) => {
    const value = applyModelProviderAuth(model.value, providerAuths);
    return {
      value,
      label: showExplicitNamespace ? value : model.label,
      description: model.description,
    };
  });
}

export function getDefaultModelForProvider(
  provider: string,
  providerAuths: Record<string, ProviderAuthConfig>,
  defaultModels: Record<string, string>,
): string {
  const defaultModel = defaultModels[provider];
  return defaultModel ? applyModelProviderAuth(defaultModel, providerAuths) : "";
}

export function getDefaultAuthMethod(provider: string): string {
  if (provider === "anthropic") return "token";
  if (provider === "openai") return "token";
  if (provider === "google") return "token";
  return "token";
}

export function createDefaultProviderAuth(provider: string): ProviderAuthConfig {
  const oauthOption = OAUTH_METHODS_BY_PROVIDER[provider]?.[0];
  return {
    auth_method: getDefaultAuthMethod(provider),
    token: "",
    profile_key: null,
    profile: null,
    oauth_provider_id: oauthOption?.oauthProviderId ?? null,
  };
}

export function normalizeProviderAuths(providerAuths: Record<string, ProviderAuthConfig> | undefined, provider: string, apiKey: string, authMethod: string): Record<string, ProviderAuthConfig> {
  const next = { ...(providerAuths || {}) };
  if (!next[provider]) {
    next[provider] = createDefaultProviderAuth(provider);
  }
  if (apiKey || authMethod !== "token") {
    next[provider] = {
      ...next[provider],
      auth_method: authMethod || next[provider].auth_method,
      token: apiKey || next[provider].token,
    };
  }
  return next;
}

export function getReferencedProviders(models: string[]): string[] {
  const unique = new Set<string>();
  for (const model of models) {
    const provider = getBaseProviderFromModel(model);
    if (!provider || LOCAL_PROVIDERS.has(provider)) continue;
    unique.add(provider);
  }
  return Array.from(unique).sort();
}

export function buildReferencedProviders(input: {
  primaryModel: string;
  fallbackModels: string[];
  agentConfigs?: Array<{ model: string; fallbackModels: string[] }>;
}): string[] {
  const models = [input.primaryModel, ...input.fallbackModels];
  for (const agent of input.agentConfigs || []) {
    models.push(agent.model, ...agent.fallbackModels);
  }
  return getReferencedProviders(models.filter(Boolean));
}

export function getProviderAuthOptions(provider: string): Array<{ value: string; label: string; description: string }> {
  const options = [{ value: "token", label: "API Key", description: "Paste an API key or token for this provider." }];

  if (provider === "anthropic") {
    options.push({ value: "setup-token", label: "Setup Token", description: "Paste a token from `claude setup-token`." });
  }

  for (const oauthOption of OAUTH_METHODS_BY_PROVIDER[provider] || []) {
    options.push({
      value: oauthOption.value,
      label: oauthOption.label,
      description: provider === "anthropic"
        ? "Open a terminal and run the Claude Code setup-token flow."
        : "Launch the provider auth flow in your browser and import the resulting profile.",
    });
  }

  return options;
}

export function isOAuthMethod(authMethod: string): boolean {
  return authMethod !== "token" && authMethod !== "setup-token";
}

export interface DeferredOAuthItem {
  id: string;
  label: string;
  targetProvider: string;
  authMethod: string;
  oauthProviderId: string;
  source: "provider" | "skill";
  sourceId: string;
}

export function getOAuthSkillRequirements(selectedSkills: string[], availableSkills: SkillOption[]): DeferredOAuthItem[] {
  return selectedSkills.flatMap((skillId) => {
    const skill = availableSkills.find((item) => item.id === skillId);
    if (!skill || skill.authMode !== "oauth" || !skill.oauthBaseProvider || !skill.oauthMethod || !skill.oauthProviderId) {
      return [];
    }

    return [{
      id: `skill:${skill.id}`,
      label: skill.name,
      targetProvider: skill.oauthBaseProvider,
      authMethod: skill.oauthMethod,
      oauthProviderId: skill.oauthProviderId,
      source: "skill" as const,
      sourceId: skill.id,
    }];
  });
}

export function buildDeferredOAuthQueue(input: {
  referencedProviders: string[];
  providerAuths: Record<string, ProviderAuthConfig>;
  selectedSkills: string[];
  availableSkills: SkillOption[];
}): DeferredOAuthItem[] {
  const queue: DeferredOAuthItem[] = [];
  const seen = new Set<string>();

  for (const provider of input.referencedProviders) {
    const auth = input.providerAuths[provider];
    if (!auth || !isOAuthMethod(auth.auth_method) || auth.profile_key) continue;
    const oauthProviderId = auth.oauth_provider_id || OAUTH_METHODS_BY_PROVIDER[provider]?.find(option => option.value === auth.auth_method)?.oauthProviderId;
    if (!oauthProviderId) continue;
    const dedupeKey = `${provider}:${auth.auth_method}:${oauthProviderId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    queue.push({
      id: `provider:${provider}`,
      label: provider.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
      targetProvider: provider,
      authMethod: auth.auth_method,
      oauthProviderId,
      source: "provider",
      sourceId: provider,
    });
  }

  for (const skillItem of getOAuthSkillRequirements(input.selectedSkills, input.availableSkills)) {
    const auth = input.providerAuths[skillItem.targetProvider];
    if (auth?.profile_key) continue;
    const dedupeKey = `${skillItem.targetProvider}:${skillItem.authMethod}:${skillItem.oauthProviderId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    queue.push(skillItem);
  }

  return queue;
}
