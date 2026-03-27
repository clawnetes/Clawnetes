import { invoke } from "../../lib/tauri";
import { useWizard } from "../../context/WizardContext";
import { MODELS_BY_PROVIDER, PROVIDER_LOGOS } from "../../presets/modelsByProvider";
import Dropdown from "../Dropdown";
import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";
import type { ReactNode } from "react";

interface StepConnectBrainProps {
  renderProviderAuthEditor: (provider: string, options?: { keyPrefix?: string; showProviderLabel?: boolean; marginTop?: string }) => ReactNode;
  getProviderDefaultModel: (provider: string) => string;
  getProviderModelOptions: (provider: string) => { value: string; label: string }[];
}

export default function StepConnectBrain({ renderProviderAuthEditor, getProviderDefaultModel, getProviderModelOptions }: StepConnectBrainProps) {
  const { state, dispatch } = useWizard();
  const {
    provider, model, thinkingLevel,
    targetEnvironment, remoteIp, remoteUser, remotePassword, remotePrivateKeyPath,
    ollamaModels, ollamaDetecting, lmstudioBaseUrl, lmstudioModels, lmstudioDetecting,
    localBaseUrl, localModels, localDetecting,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  const remoteConfig = targetEnvironment === "cloud" ? {
    ip: remoteIp, user: remoteUser,
    password: remotePassword || null,
    privateKeyPath: remotePrivateKeyPath || null
  } : null;

  return (
    <div className="step-view" data-testid="step-connect-brain">
      <h2>Connect Brain</h2>
      <p className="step-description">Select your AI provider and authentication method.</p>

      <div className="form-group">
        <label>AI Provider</label>
        <Dropdown
          testId="dropdown-provider"
          value={provider}
          onChange={(p) => {
            setField("provider", p);
            const defaultModel = getProviderDefaultModel(p);
            if (defaultModel) {
              setField("model", defaultModel);
            } else if (getProviderModelOptions(p).length > 0) {
              setField("model", getProviderModelOptions(p)[0].value);
            }
          }}
          options={[
            { value: "anthropic", label: "Anthropic", icon: PROVIDER_LOGOS["anthropic"] },
            { value: "openai", label: "OpenAI", icon: PROVIDER_LOGOS["openai"] },
            { value: "google", label: "Google Gemini", icon: PROVIDER_LOGOS["google"] },
            { value: "openrouter", label: "OpenRouter", icon: PROVIDER_LOGOS["openrouter"] },
            { value: "xai", label: "xAI (Grok)", icon: PROVIDER_LOGOS["xai"] },
            { value: "ollama", label: "Ollama (Local)", icon: PROVIDER_LOGOS["ollama"] },
            { value: "lmstudio", label: "LM Studio (Local)", icon: PROVIDER_LOGOS["lmstudio"] },
            { value: "local", label: "Custom Local Endpoint", icon: PROVIDER_LOGOS["local"] },
          ]}
        />
      </div>

      {renderProviderAuthEditor(provider, { keyPrefix: "primary-provider", showProviderLabel: false, marginTop: "1.5rem" })}

      {provider === "lmstudio" && (
        <div className="form-group" style={{ marginTop: "1.5rem" }}>
          <label>LM Studio Base URL</label>
          <input {...TEXT_ENTRY_PROPS} type="text" value={lmstudioBaseUrl} onChange={(e) => setField("lmstudioBaseUrl", e.target.value)} placeholder="http://localhost:1234" />
        </div>
      )}

      {provider === "local" && (
        <div className="form-group" style={{ marginTop: "1.5rem" }}>
          <label>Local Endpoint Base URL</label>
          <input {...TEXT_ENTRY_PROPS} type="text" value={localBaseUrl} onChange={(e) => setField("localBaseUrl", e.target.value)} placeholder="http://localhost:8080" />
        </div>
      )}

      <div className="form-group" style={{ marginTop: "1.5rem" }}>
        <label>Primary Model</label>
        {provider === "ollama" && (
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <button className="secondary" style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }} disabled={ollamaDetecting}
              onClick={async () => {
                setField("ollamaDetecting", true);
                try {
                  const models: string[] = await invoke("get_ollama_models", { remote: remoteConfig });
                  setField("ollamaModels", models);
                  if (models.length > 0) setField("model", `ollama/${models[0]}`);
                } catch (e) { console.error("Ollama detection failed:", e); }
                setField("ollamaDetecting", false);
              }}
            >
              {ollamaDetecting ? "Detecting..." : "Detect Models"}
            </button>
            {ollamaModels.length > 0 && <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>Found {ollamaModels.length} model(s)</span>}
          </div>
        )}
        {provider === "lmstudio" && (
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <button className="secondary" style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }} disabled={lmstudioDetecting}
              onClick={async () => {
                setField("lmstudioDetecting", true);
                try {
                  const models: string[] = await invoke("get_lmstudio_models", { baseUrl: lmstudioBaseUrl, remote: remoteConfig });
                  const prefixed = models.map(m => `lmstudio/${m}`);
                  setField("lmstudioModels", prefixed);
                  if (prefixed.length > 0) setField("model", prefixed[0]);
                } catch (e) { console.error("LM Studio detection failed:", e); }
                setField("lmstudioDetecting", false);
              }}
            >
              {lmstudioDetecting ? "Detecting..." : "Detect Models"}
            </button>
            {lmstudioModels.length > 0 && <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>Found {lmstudioModels.length} model(s)</span>}
          </div>
        )}
        {provider === "local" && (
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <button className="secondary" style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }} disabled={localDetecting}
              onClick={async () => {
                setField("localDetecting", true);
                try {
                  const models: string[] = await invoke("get_lmstudio_models", { baseUrl: localBaseUrl, remote: remoteConfig });
                  setField("localModels", models);
                  if (models.length > 0) setField("model", `local/${models[0]}`);
                } catch (e) { console.error("Local endpoint detection failed:", e); }
                setField("localDetecting", false);
              }}
            >
              {localDetecting ? "Detecting..." : "Detect Models"}
            </button>
            {localModels.length > 0 && <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>Found {localModels.length} model(s)</span>}
          </div>
        )}
        <Dropdown
          testId="dropdown-model"
          value={model}
          onChange={(v) => setField("model", v)}
          searchable={MODELS_BY_PROVIDER[provider] ? MODELS_BY_PROVIDER[provider].length > 10 : false}
          options={
            provider === "ollama" && ollamaModels.length > 0
              ? ollamaModels.map(m => ({ value: `ollama/${m}`, label: m }))
              : provider === "lmstudio" && lmstudioModels.length > 0
                ? lmstudioModels.map(m => ({ value: m, label: m }))
                : provider === "local" && localModels.length > 0
                  ? localModels.map(m => ({ value: `local/${m}`, label: m }))
                  : MODELS_BY_PROVIDER[provider]
                    ? getProviderModelOptions(provider)
                    : [{ value: model, label: model }]
          }
        />
        {(provider === "ollama" || provider === "lmstudio" || provider === "local") && (
          <div style={{ marginTop: "0.5rem" }}>
            <input
              {...TEXT_ENTRY_PROPS}
              type="text"
              placeholder={`Or type model name manually (e.g. ${provider === "ollama" ? "llama3.2" : "your-model-id"})`}
              style={{ fontSize: "0.85rem" }}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val) setField("model", provider === "lmstudio" ? val : `${provider}/${val}`);
              }}
            />
          </div>
        )}
      </div>

      {provider === "anthropic" && model.includes("claude-") && model.includes("-4") && (
        <div className="form-group" style={{ marginTop: "1.5rem" }}>
          <label>Thinking Level</label>
          <Dropdown
            value={thinkingLevel}
            onChange={(v) => setField("thinkingLevel", v)}
            options={[
              { value: "adaptive", label: "Adaptive (Recommended)", description: "Automatically adjusts thinking depth" },
              { value: "off", label: "Off", description: "No extended thinking" },
              { value: "low", label: "Low", description: "Minimal thinking budget" },
              { value: "medium", label: "Medium", description: "Balanced thinking budget" },
              { value: "high", label: "High", description: "Maximum thinking depth" },
            ]}
          />
          <p className="input-hint">Extended thinking improves reasoning on complex tasks. Available for Claude 4.x models.</p>
        </div>
      )}

      {["ollama", "lmstudio", "local"].includes(provider) && (
        <p className="input-hint" style={{ marginBottom: "1rem", textAlign: "center", color: "var(--success)" }}>
          No API key required for local providers.
        </p>
      )}
      {!["ollama", "lmstudio", "local"].includes(provider) && (
        <p className="input-hint" style={{ marginBottom: "1rem", textAlign: "center" }}>
          You can skip this for now and configure it later via 'Reconfigure'.
        </p>
      )}
      <div className="button-group">
        <button className="primary" data-testid="btn-next" onClick={() => setField("step", 9)}>Next</button>
        <button className="secondary" onClick={() => setField("step", 6.5)}>Back</button>
      </div>
    </div>
  );
}
