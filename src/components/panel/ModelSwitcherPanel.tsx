import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, ProviderLogo } from "../ui";
import {
  MODELS_BY_PROVIDER,
  DEFAULT_MODELS,
} from "../../presets/modelsByProvider";
import {
  getMissingReferencedProviders,
  getBaseProviderFromModel,
  getProviderAuthOptions,
  isOAuthMethod,
  LOCAL_PROVIDERS,
  createDefaultProviderAuth,
  OAUTH_METHODS_BY_PROVIDER,
} from "../../utils/providerAuth";
import type { ProviderAuthConfig } from "../../types";
import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";

interface ModelSwitcherPanelProps {
  currentModel: string;
  fallbackModels: string[];
  currentLocalBaseUrl?: string;
  currentLmstudioBaseUrl?: string;
  onModelChange?: (model: string) => void;
  onFallbacksChange?: (models: string[]) => void;
  onLocalBaseUrlChange?: (provider: "lmstudio" | "local", baseUrl: string) => void;
  providerAuths?: Record<string, ProviderAuthConfig>;
  onProviderAuthChange?: (provider: string, auth: ProviderAuthConfig) => void;
  onStartOAuth?: (provider: string, authMethod: string, oauthProviderId: string) => Promise<ProviderAuthConfig>;
  onDetectLocalModels?: (provider: "ollama" | "lmstudio" | "local", baseUrl?: string) => Promise<string[]>;
}

const ALL_PROVIDERS = Object.keys(MODELS_BY_PROVIDER);

function displayProviderName(provider: string): string {
  if (!provider) return "";
  return provider
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••••••";
  return token.slice(0, 3) + "••••" + token.slice(-4);
}

/* ─── Styled Dropdown ─── */

interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

function StyledDropdown({
  options,
  value,
  onChange,
  placeholder,
  testId,
}: {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 rounded-lg bg-[var(--surface-1)] border border-[var(--sidebar-border)] px-3 py-2 text-sm text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors text-left"
      >
        {selected?.icon && <ProviderLogo provider={selected.icon} size={16} />}
        <span className="flex-1 truncate">
          {selected?.label || placeholder || "Select..."}
        </span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-[240px] overflow-y-auto rounded-lg bg-[var(--surface-panel)] border border-[var(--sidebar-border)] shadow-lg">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  isSelected
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "text-[var(--text-main)] hover:bg-[var(--surface-hover)]"
                }`}
                data-testid={`dropdown-option-${option.value}`}
              >
                {option.icon && <ProviderLogo provider={option.icon} size={16} />}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate">{option.label}</span>
                  {option.description && (
                    <span className="text-[0.65rem] text-[var(--text-muted)] truncate">{option.description}</span>
                  )}
                </div>
                {isSelected && (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
                    <path d="M4 8.5L7 11.5L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Auth Section ─── */

function AuthSection({
  provider,
  existingAuth,
  draftAuth,
  onDraftAuthChange,
}: {
  provider: string;
  existingAuth: ProviderAuthConfig | undefined;
  draftAuth: ProviderAuthConfig;
  onDraftAuthChange: (auth: ProviderAuthConfig) => void;
}) {
  const [editing, setEditing] = useState(false);
  const authOptions = getProviderAuthOptions(provider);
  const hasExistingCredential = existingAuth
    ? isOAuthMethod(existingAuth.auth_method)
      ? !!existingAuth.profile_key
      : !!existingAuth.token
    : false;

  if (hasExistingCredential && !editing) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="auth-status">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-subtle)]">Authentication</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[0.7rem] text-[var(--accent)] hover:underline"
            data-testid="auth-edit-btn"
          >
            Edit
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-[var(--surface-1)] border border-[var(--sidebar-border)] px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-green-500 shrink-0" aria-hidden="true">
            <path d="M4 8.5L7 11.5L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs text-[var(--text-main)]">
            {isOAuthMethod(existingAuth!.auth_method)
              ? `OAuth profile: ${existingAuth!.profile_key || "connected"}`
              : `API Key: ${maskToken(existingAuth!.token)}`}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="auth-editor">
      <span className="text-xs font-medium text-[var(--text-subtle)]">Authentication</span>

      {authOptions.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {authOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                const oauthOpt = isOAuthMethod(option.value);
                onDraftAuthChange({
                  ...draftAuth,
                  auth_method: option.value,
                  ...(oauthOpt
                    ? { token: "" }
                    : { profile_key: null, profile: null }),
                });
              }}
              className={`px-2.5 py-1 rounded-md text-[0.7rem] font-medium transition-colors ${
                draftAuth.auth_method === option.value
                  ? "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30"
                  : "bg-[var(--surface-1)] text-[var(--text-subtle)] border border-[var(--sidebar-border)] hover:bg-[var(--surface-hover)]"
              }`}
              data-testid={`auth-method-${option.value}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {(draftAuth.auth_method === "token" || draftAuth.auth_method === "setup-token") && (
        <input
          {...TEXT_ENTRY_PROPS}
          type="password"
          placeholder={
            draftAuth.auth_method === "setup-token"
              ? "Paste `claude setup-token` output"
              : provider === "google"
                ? "Paste your Gemini API key"
                : `Paste your ${displayProviderName(provider)} API key`
          }
          value={draftAuth.token}
          onChange={(e) => onDraftAuthChange({ ...draftAuth, token: e.target.value })}
          className="w-full px-3 py-2 rounded-md bg-[var(--surface-1)] border border-[var(--sidebar-border)] text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
          data-testid="auth-token-input"
        />
      )}

      {isOAuthMethod(draftAuth.auth_method) && (
        <p className="text-[0.7rem] text-[var(--text-muted)]">
          {existingAuth && isOAuthMethod(existingAuth.auth_method) && existingAuth.profile_key && existingAuth.auth_method === draftAuth.auth_method
            ? "Already authenticated via OAuth."
            : "OAuth will be initiated when you save."}
          {provider === "google" && draftAuth.auth_method === "google-gemini-cli" && (
            <span className="block mt-1 text-[var(--warning,#b45309)]">
              Unofficial Google Code Assist integration. If requests fail, use the Gemini API key option instead.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/* ─── Local Model Section ─── */

function LocalModelSection({
  provider,
  detectedModels,
  detecting,
  draftModel,
  onDraftModelChange,
  onDetect,
  baseUrl,
  onBaseUrlChange,
  customModelName,
  onCustomModelNameChange,
}: {
  provider: string;
  detectedModels: string[];
  detecting: boolean;
  draftModel: string;
  onDraftModelChange: (model: string) => void;
  onDetect: () => void;
  baseUrl?: string;
  onBaseUrlChange?: (url: string) => void;
  customModelName?: string;
  onCustomModelNameChange?: (name: string) => void;
}) {
  if (provider === "local") {
    // Custom local: URL + model name inputs
    return (
      <div className="flex flex-col gap-2" data-testid="local-model-config">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--text-subtle)]">Base URL</span>
          <input
            {...TEXT_ENTRY_PROPS}
            type="text"
            placeholder="http://localhost:8080"
            value={baseUrl || ""}
            onChange={(e) => onBaseUrlChange?.(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-[var(--surface-1)] border border-[var(--sidebar-border)] text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
            data-testid="local-base-url"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--text-subtle)]">Model Name</span>
          <input
            {...TEXT_ENTRY_PROPS}
            type="text"
            placeholder="e.g. my-model"
            value={customModelName || ""}
            onChange={(e) => {
              onCustomModelNameChange?.(e.target.value);
              if (e.target.value) {
                onDraftModelChange(`local/${e.target.value}`);
              }
            }}
            className="w-full px-3 py-2 rounded-md bg-[var(--surface-1)] border border-[var(--sidebar-border)] text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
            data-testid="local-model-name"
          />
        </div>
        {baseUrl && (
          <button
            type="button"
            onClick={onDetect}
            disabled={detecting}
            className="self-start px-2.5 py-1 rounded-md text-[0.7rem] font-medium bg-[var(--surface-1)] border border-[var(--sidebar-border)] text-[var(--text-subtle)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
            data-testid="detect-models-btn"
          >
            {detecting ? "Detecting..." : "Detect Models"}
          </button>
        )}
        {detectedModels.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[0.7rem] text-[var(--text-muted)]">
              Found {detectedModels.length} model(s):
            </span>
            {detectedModels.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onDraftModelChange(`local/${m}`);
                  onCustomModelNameChange?.(m);
                }}
                className={`text-left px-2.5 py-1 rounded-md text-xs transition-colors ${
                  draftModel === `local/${m}`
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "text-[var(--text-main)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Ollama or LM Studio
  const isLmstudio = provider === "lmstudio";
  return (
    <div className="flex flex-col gap-2" data-testid="local-model-config">
      {isLmstudio && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--text-subtle)]">Base URL</span>
          <input
            {...TEXT_ENTRY_PROPS}
            type="text"
            placeholder="http://localhost:1234"
            value={baseUrl || ""}
            onChange={(e) => onBaseUrlChange?.(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-[var(--surface-1)] border border-[var(--sidebar-border)] text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
            data-testid="local-base-url"
          />
        </div>
      )}

      <button
        type="button"
        onClick={onDetect}
        disabled={detecting}
        className="self-start px-2.5 py-1.5 rounded-md text-[0.7rem] font-medium bg-[var(--surface-1)] border border-[var(--sidebar-border)] text-[var(--text-subtle)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
        data-testid="detect-models-btn"
      >
        {detecting ? "Detecting..." : "Detect Models"}
      </button>

      {detectedModels.length > 0 && (
        <div className="flex flex-col gap-0.5 max-h-[160px] overflow-y-auto">
          <span className="text-[0.7rem] text-[var(--text-muted)] mb-1">
            Found {detectedModels.length} model(s):
          </span>
          {detectedModels.map((m) => {
            const fullValue = `${provider}/${m}`;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onDraftModelChange(fullValue)}
                className={`text-left px-2.5 py-1 rounded-md text-xs transition-colors ${
                  draftModel === fullValue
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "text-[var(--text-main)] hover:bg-[var(--surface-hover)]"
                }`}
                data-testid={`detected-model-${m}`}
              >
                {m}
              </button>
            );
          })}
        </div>
      )}

      {!detecting && detectedModels.length === 0 && (
        <p className="text-[0.7rem] text-[var(--text-muted)]">
          Make sure {displayProviderName(provider)} is running, then click Detect Models.
        </p>
      )}
    </div>
  );
}

/* ─── Main Panel ─── */

function ModelSwitcherPanel({
  currentModel,
  fallbackModels,
  currentLocalBaseUrl = "",
  currentLmstudioBaseUrl = "",
  onModelChange,
  onFallbacksChange,
  onLocalBaseUrlChange,
  providerAuths = {},
  onProviderAuthChange,
  onStartOAuth,
  onDetectLocalModels,
}: ModelSwitcherPanelProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Draft state for primary model
  const [draftProvider, setDraftProvider] = useState(() => getBaseProviderFromModel(currentModel) || "anthropic");
  const [draftModel, setDraftModel] = useState(currentModel);
  const [draftAuth, setDraftAuth] = useState<ProviderAuthConfig>(
    () => providerAuths[getBaseProviderFromModel(currentModel) || "anthropic"] || createDefaultProviderAuth(getBaseProviderFromModel(currentModel) || "anthropic"),
  );

  // Draft state for fallbacks
  const [draftFallbacks, setDraftFallbacks] = useState(fallbackModels);

  // Local model detection state
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [localBaseUrl, setLocalBaseUrl] = useState("");
  const [customModelName, setCustomModelName] = useState("");

  // Fallback picker state
  const [addingFallback, setAddingFallback] = useState(false);
  const [fbDraftProvider, setFbDraftProvider] = useState("");
  const [fbDraftModel, setFbDraftModel] = useState("");
  const [fbDraftAuth, setFbDraftAuth] = useState<ProviderAuthConfig | null>(null);
  const [fbDetectedModels, setFbDetectedModels] = useState<string[]>([]);
  const [fbDetecting, setFbDetecting] = useState(false);
  const [fbLocalBaseUrl, setFbLocalBaseUrl] = useState("");
  const [fbCustomModelName, setFbCustomModelName] = useState("");

  const getProviderBaseUrl = useCallback((provider: string) => {
    if (provider === "lmstudio") return currentLmstudioBaseUrl;
    if (provider === "local") return currentLocalBaseUrl;
    return "";
  }, [currentLocalBaseUrl, currentLmstudioBaseUrl]);

  // Re-sync draft state when props change (after save)
  const prevModelRef = useRef(currentModel);
  const prevFallbacksRef = useRef(fallbackModels);
  useEffect(() => {
    if (prevModelRef.current !== currentModel || prevFallbacksRef.current !== fallbackModels) {
      setDraftModel(currentModel);
      setDraftProvider(getBaseProviderFromModel(currentModel) || "anthropic");
      setDraftAuth(
        providerAuths[getBaseProviderFromModel(currentModel) || "anthropic"] || createDefaultProviderAuth(getBaseProviderFromModel(currentModel) || "anthropic"),
      );
      setDraftFallbacks(fallbackModels);
      setLocalBaseUrl(getProviderBaseUrl(getBaseProviderFromModel(currentModel) || "anthropic"));
      prevModelRef.current = currentModel;
      prevFallbacksRef.current = fallbackModels;
      setSaveError("");
    }
  }, [currentModel, fallbackModels, getProviderBaseUrl, providerAuths]);

  useEffect(() => {
    if (draftProvider === "lmstudio" || draftProvider === "local") {
      setLocalBaseUrl(getProviderBaseUrl(draftProvider));
    }
  }, [draftProvider, getProviderBaseUrl]);

  // Check if dirty
  const isDirty = useMemo(() => {
    const modelChanged = draftModel !== currentModel || draftProvider !== (getBaseProviderFromModel(currentModel) || "anthropic");
    const fallbacksChanged = JSON.stringify(draftFallbacks) !== JSON.stringify(fallbackModels);
    const baseUrlChanged = (draftProvider === "lmstudio" || draftProvider === "local")
      && localBaseUrl !== getProviderBaseUrl(draftProvider);
    return modelChanged || fallbacksChanged || baseUrlChanged;
  }, [currentModel, draftFallbacks, draftModel, draftProvider, fallbackModels, getProviderBaseUrl, localBaseUrl]);

  const effectiveProviderAuths = useMemo(() => ({
    ...providerAuths,
    ...(draftProvider && !LOCAL_PROVIDERS.has(draftProvider) ? { [draftProvider]: draftAuth } : {}),
  }), [draftAuth, draftProvider, providerAuths]);

  const currentMissingReferencedProviders = useMemo(() => getMissingReferencedProviders({
    primaryModel: currentModel,
    fallbackModels,
    providerAuths,
    options: {
      allowPendingOAuth: true,
      oauthHandlerAvailable: !!onStartOAuth,
    },
  }), [currentModel, fallbackModels, onStartOAuth, providerAuths]);

  const nextMissingReferencedProviders = useMemo(() => getMissingReferencedProviders({
    primaryModel: draftModel,
    fallbackModels: draftFallbacks,
    providerAuths: effectiveProviderAuths,
    options: {
      allowPendingOAuth: true,
      oauthHandlerAvailable: !!onStartOAuth,
    },
  }), [draftFallbacks, draftModel, effectiveProviderAuths, onStartOAuth]);

  const introducedMissingProviders = useMemo(
    () => nextMissingReferencedProviders.filter(
      (provider) => !currentMissingReferencedProviders.includes(provider),
    ),
    [currentMissingReferencedProviders, nextMissingReferencedProviders],
  );

  const currentProvider = getBaseProviderFromModel(currentModel);
  const currentModelName = currentModel
    ? currentModel.split("/").slice(1).join("/")
    : "";

  const providerOptions: DropdownOption[] = useMemo(
    () =>
      ALL_PROVIDERS.map((p) => ({
        value: p,
        label: displayProviderName(p),
        icon: p,
      })),
    [],
  );

  const modelOptions: DropdownOption[] = useMemo(() => {
    if (!draftProvider || LOCAL_PROVIDERS.has(draftProvider)) return [];
    return (MODELS_BY_PROVIDER[draftProvider] || []).map((m) => ({
      value: m.value,
      label: m.label,
      description: m.description,
    }));
  }, [draftProvider]);

  const fbModelOptions: DropdownOption[] = useMemo(() => {
    if (!fbDraftProvider || LOCAL_PROVIDERS.has(fbDraftProvider)) return [];
    const excluded = new Set([draftModel, ...draftFallbacks]);
    return (MODELS_BY_PROVIDER[fbDraftProvider] || [])
      .filter((m) => !excluded.has(m.value))
      .map((m) => ({
        value: m.value,
        label: m.label,
        description: m.description,
      }));
  }, [fbDraftProvider, draftModel, draftFallbacks]);

  const handleProviderChange = useCallback(
    (provider: string) => {
      setDraftProvider(provider);
      setDetectedModels([]);
      setDetecting(false);
      setCustomModelName("");
      setLocalBaseUrl(
        provider === "lmstudio"
          ? (currentLmstudioBaseUrl || "http://localhost:1234")
          : provider === "local"
            ? (currentLocalBaseUrl || "http://localhost:8080")
            : "",
      );
      if (LOCAL_PROVIDERS.has(provider)) {
        setDraftModel(DEFAULT_MODELS[provider] || "");
      } else {
        setDraftModel(DEFAULT_MODELS[provider] || "");
      }
      setDraftAuth(
        providerAuths[provider] || createDefaultProviderAuth(provider),
      );
    },
    [currentLmstudioBaseUrl, currentLocalBaseUrl, providerAuths],
  );

  const handleDetectModels = useCallback(async () => {
    if (!onDetectLocalModels) return;
    setDetecting(true);
    try {
      const models = await onDetectLocalModels(
        draftProvider as "ollama" | "lmstudio" | "local",
        localBaseUrl || undefined,
      );
      setDetectedModels(models);
      if (models.length > 0) {
        const prefix = draftProvider === "local" ? "local" : draftProvider;
        setDraftModel(`${prefix}/${models[0]}`);
        if (draftProvider === "local") {
          setCustomModelName(models[0]);
        }
      }
    } catch (e) {
      console.error("Model detection failed:", e);
      setDetectedModels([]);
    }
    setDetecting(false);
  }, [onDetectLocalModels, draftProvider, localBaseUrl]);

  const handleFbDetectModels = useCallback(async () => {
    if (!onDetectLocalModels) return;
    setFbDetecting(true);
    try {
      const models = await onDetectLocalModels(
        fbDraftProvider as "ollama" | "lmstudio" | "local",
        fbLocalBaseUrl || undefined,
      );
      setFbDetectedModels(models);
      if (models.length > 0) {
        const prefix = fbDraftProvider === "local" ? "local" : fbDraftProvider;
        setFbDraftModel(`${prefix}/${models[0]}`);
      }
    } catch (e) {
      console.error("Model detection failed:", e);
      setFbDetectedModels([]);
    }
    setFbDetecting(false);
  }, [onDetectLocalModels, fbDraftProvider, fbLocalBaseUrl]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError("");

    try {
      if (introducedMissingProviders.length > 0) {
        throw new Error(`Missing authentication for ${introducedMissingProviders.join(", ")}.`);
      }

      // Check if OAuth is needed
      const isLocal = LOCAL_PROVIDERS.has(draftProvider);
      const needsOAuth =
        !isLocal &&
        isOAuthMethod(draftAuth.auth_method) &&
        !draftAuth.profile_key;
      const existingAuth = providerAuths[draftProvider];
      const alreadyAuthenticated = existingAuth &&
        isOAuthMethod(existingAuth.auth_method) &&
        !!existingAuth.profile_key &&
        existingAuth.auth_method === draftAuth.auth_method;

      if (needsOAuth && !alreadyAuthenticated && onStartOAuth) {
        // Trigger OAuth flow
        const oauthProviderId =
          draftAuth.oauth_provider_id ||
          OAUTH_METHODS_BY_PROVIDER[draftProvider]?.find(
            (o) => o.value === draftAuth.auth_method,
          )?.oauthProviderId ||
          "";
        await onStartOAuth(draftProvider, draftAuth.auth_method, oauthProviderId);
      } else {
        // Save auth if modified (token-based)
        const authChanged =
          !isLocal &&
          (!existingAuth ||
            existingAuth.auth_method !== draftAuth.auth_method ||
            existingAuth.token !== draftAuth.token);
        if (authChanged) {
          onProviderAuthChange?.(draftProvider, draftAuth);
        }
      }

      // Save model change
      if (draftModel && draftModel !== currentModel) {
        onModelChange?.(draftModel);
      }

      // Save fallbacks change
      if (JSON.stringify(draftFallbacks) !== JSON.stringify(fallbackModels)) {
        onFallbacksChange?.(draftFallbacks);
      }

      if ((draftProvider === "lmstudio" || draftProvider === "local") && localBaseUrl !== getProviderBaseUrl(draftProvider)) {
        onLocalBaseUrlChange?.(draftProvider, localBaseUrl);
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [
    draftModel,
    draftProvider,
    draftAuth,
    draftFallbacks,
    currentModel,
    fallbackModels,
    getProviderBaseUrl,
    localBaseUrl,
    providerAuths,
    onLocalBaseUrlChange,
    onModelChange,
    onProviderAuthChange,
    onStartOAuth,
    onFallbacksChange,
    introducedMissingProviders,
  ]);

  const handleCancel = useCallback(() => {
    setDraftModel(currentModel);
    setDraftProvider(getBaseProviderFromModel(currentModel) || "anthropic");
    setDraftAuth(providerAuths[getBaseProviderFromModel(currentModel) || "anthropic"] || createDefaultProviderAuth(getBaseProviderFromModel(currentModel) || "anthropic"));
    setDraftFallbacks(fallbackModels);
    setLocalBaseUrl(getProviderBaseUrl(getBaseProviderFromModel(currentModel) || "anthropic"));
    setSaveError("");
  }, [currentModel, fallbackModels, getProviderBaseUrl, providerAuths]);

  function handleRemoveFallback(model: string) {
    setDraftFallbacks(draftFallbacks.filter((m) => m !== model));
  }

  function handleAddFallback() {
    if (fbDraftModel) {
      setDraftFallbacks([...draftFallbacks, fbDraftModel]);
      if ((fbDraftProvider === "lmstudio" || fbDraftProvider === "local") && fbLocalBaseUrl !== getProviderBaseUrl(fbDraftProvider)) {
        onLocalBaseUrlChange?.(fbDraftProvider, fbLocalBaseUrl);
      }
      // If auth was provided for fallback provider, save it immediately
      if (fbDraftAuth && fbDraftAuth.token) {
        onProviderAuthChange?.(fbDraftProvider, fbDraftAuth);
      }
    }
    setAddingFallback(false);
    setFbDraftProvider("");
    setFbDraftModel("");
    setFbDraftAuth(null);
    setFbDetectedModels([]);
    setFbLocalBaseUrl("");
    setFbCustomModelName("");
  }

  function startAddFallback() {
    setFbDraftProvider("");
    setFbDraftModel("");
    setFbDraftAuth(null);
    setFbDetectedModels([]);
    setFbLocalBaseUrl("");
    setFbCustomModelName("");
    setAddingFallback(true);
  }

  const isLocalProvider = LOCAL_PROVIDERS.has(draftProvider);

  return (
    <div className="flex flex-col gap-4" data-testid="model-switcher-panel">
      {/* Primary model editor */}
      <div>
        <h4 className="text-sm font-semibold text-[var(--text-main)] mb-2">
          Primary Model
        </h4>
          <div className="flex flex-col gap-3 rounded-lg border border-[var(--sidebar-border)] bg-[var(--surface-0)] p-3">
            {/* Provider selector */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[var(--text-subtle)]">
                Provider
              </span>
              <StyledDropdown
                options={providerOptions}
                value={draftProvider}
                onChange={handleProviderChange}
                placeholder="Select a provider..."
                testId="provider-dropdown"
              />
            </div>

            {/* Model selector — for remote providers use dropdown */}
            {draftProvider && !isLocalProvider && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[var(--text-subtle)]">
                  Model
                </span>
                <StyledDropdown
                  options={modelOptions}
                  value={draftModel}
                  onChange={setDraftModel}
                  placeholder="Select a model..."
                  testId="model-dropdown"
                />
              </div>
            )}

            {/* Local model section — for ollama, lmstudio, local */}
            {draftProvider && isLocalProvider && (
              <LocalModelSection
                provider={draftProvider}
                detectedModels={detectedModels}
                detecting={detecting}
                draftModel={draftModel}
                onDraftModelChange={setDraftModel}
                onDetect={handleDetectModels}
                baseUrl={localBaseUrl}
                onBaseUrlChange={setLocalBaseUrl}
                customModelName={customModelName}
                onCustomModelNameChange={setCustomModelName}
              />
            )}

            {/* Auth section — for remote providers only */}
            {draftProvider && !isLocalProvider && (
              <AuthSection
                provider={draftProvider}
                existingAuth={providerAuths[draftProvider]}
                draftAuth={draftAuth}
                onDraftAuthChange={setDraftAuth}
              />
            )}

            {/* Save error */}
            {saveError && (
              <p className="text-[0.7rem] text-red-500">{saveError}</p>
            )}

            {!saveError && introducedMissingProviders.length > 0 && (
              <p className="text-[0.7rem] text-red-500" data-testid="missing-provider-auth-error">
                Missing authentication for {introducedMissingProviders.join(", ")}.
              </p>
            )}

            {/* Save / Cancel */}
            {isDirty && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || introducedMissingProviders.length > 0}
                  className="px-3 py-2 rounded-md text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="model-save-btn"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className="px-3 py-2 rounded-md text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors"
                  data-testid="model-cancel-btn"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
      </div>

      {/* Divider */}
      <div className="border-t border-[var(--sidebar-border)]" />

      {/* Fallback Models section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-[var(--text-main)]">
            Fallback Models
          </h4>
          <Badge variant="neutral">{draftFallbacks.length}</Badge>
        </div>

        {draftFallbacks.length === 0 && !addingFallback && (
          <p className="text-xs text-[var(--text-muted)] py-2 text-center">
            No fallback models configured.
          </p>
        )}

        <div className="flex flex-col gap-1">
          {draftFallbacks.map((model) => {
            const fbProvider = getBaseProviderFromModel(model);
            const fbModelName = model.split("/").slice(1).join("/");
            return (
              <div
                key={model}
                className="flex items-center gap-2 rounded-md bg-[var(--surface-1)] border border-[var(--sidebar-border)] px-2.5 py-1.5"
                data-testid={`fallback-model-${model}`}
              >
                {fbProvider && <ProviderLogo provider={fbProvider} size={14} />}
                <span className="flex-1 text-xs text-[var(--text-main)] truncate">
                  {fbModelName || model}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveFallback(model)}
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                  aria-label={`Remove ${fbModelName || model}`}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 4l8 8" />
                    <path d="M12 4l-8 8" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* Add fallback editor */}
        {addingFallback && (
          <div className="mt-2 flex flex-col gap-3 rounded-lg border border-[var(--sidebar-border)] bg-[var(--surface-0)] p-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[var(--text-subtle)]">Provider</span>
              <StyledDropdown
                options={providerOptions}
                value={fbDraftProvider}
                onChange={(p) => {
                  setFbDraftProvider(p);
                  setFbDetectedModels([]);
                  setFbLocalBaseUrl(
                    p === "lmstudio"
                      ? (currentLmstudioBaseUrl || "http://localhost:1234")
                      : p === "local"
                        ? (currentLocalBaseUrl || "http://localhost:8080")
                        : "",
                  );
                  setFbCustomModelName("");
                  setFbDraftModel(LOCAL_PROVIDERS.has(p) ? "" : (DEFAULT_MODELS[p] || ""));
                }}
                placeholder="Select a provider..."
                testId="fallback-provider-dropdown"
              />
            </div>

            {fbDraftProvider && !LOCAL_PROVIDERS.has(fbDraftProvider) && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[var(--text-subtle)]">Model</span>
                <StyledDropdown
                  options={fbModelOptions}
                  value={fbDraftModel}
                  onChange={setFbDraftModel}
                  placeholder="Select a model..."
                  testId="fallback-model-dropdown"
                />
              </div>
            )}

            {fbDraftProvider && LOCAL_PROVIDERS.has(fbDraftProvider) && (
              <LocalModelSection
                provider={fbDraftProvider}
                detectedModels={fbDetectedModels}
                detecting={fbDetecting}
                draftModel={fbDraftModel}
                onDraftModelChange={setFbDraftModel}
                onDetect={handleFbDetectModels}
                baseUrl={fbLocalBaseUrl}
                onBaseUrlChange={setFbLocalBaseUrl}
                customModelName={fbCustomModelName}
                onCustomModelNameChange={setFbCustomModelName}
              />
            )}

            {/* Auth section for fallback provider — for remote providers only */}
            {fbDraftProvider && !LOCAL_PROVIDERS.has(fbDraftProvider) && (
              <AuthSection
                provider={fbDraftProvider}
                existingAuth={providerAuths[fbDraftProvider]}
                draftAuth={fbDraftAuth || createDefaultProviderAuth(fbDraftProvider)}
                onDraftAuthChange={setFbDraftAuth}
              />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddFallback}
                disabled={!fbDraftModel}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="fallback-add-btn"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingFallback(false);
                  setFbDraftProvider("");
                  setFbDraftModel("");
                  setFbDetectedModels([]);
                }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!addingFallback && onFallbacksChange && (
          <button
            type="button"
            onClick={startAddFallback}
            className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[var(--sidebar-border)] text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--text-muted)] transition-colors"
            data-testid="add-fallback-btn"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M8 3v10" />
              <path d="M3 8h10" />
            </svg>
            Add Fallback
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(ModelSwitcherPanel);
