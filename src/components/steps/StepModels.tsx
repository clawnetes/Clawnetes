import { memo } from "react";
import { invoke } from "../../lib/tauri";
import { useWizard } from "../../context/WizardContext";
import { MODELS_BY_PROVIDER, PROVIDER_LOGOS } from "../../presets/modelsByProvider";
import { buildReferencedProviders, getBaseProviderFromModel } from "../../utils/providerAuth";
import Dropdown from "../Dropdown";
import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";
import type { ReactNode } from "react";

interface StepModelsProps {
  renderProviderAuthEditor: (provider: string, options?: { keyPrefix?: string; showProviderLabel?: boolean; marginTop?: string }) => ReactNode;
  getProviderDefaultModel: (provider: string) => string;
  getProviderModelOptions: (provider: string) => { value: string; label: string }[];
}

function StepModels({ renderProviderAuthEditor, getProviderDefaultModel, getProviderModelOptions }: StepModelsProps) {
  const { state, dispatch } = useWizard();
  const {
    provider, model, enableFallbacks, fallbackModels,
    ollamaDetecting, ollamaModels, lmstudioDetecting, lmstudioModels,
    localDetecting, localModels, lmstudioBaseUrl, localBaseUrl,
    targetEnvironment, remoteIp, remoteUser, remotePassword, remotePrivateKeyPath,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  const referencedProviders = buildReferencedProviders({
    primaryModel: model,
    fallbackModels: enableFallbacks ? fallbackModels.filter(Boolean) : [],
  });

  return (
    <div className="step-view" data-testid="step-models">
      <h2>Model Configuration</h2>
      <p className="step-description">Configure your primary and fallback models.</p>

      <div className="form-group" style={{ marginBottom: "1.5rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px" }}>
        <label>Primary Model</label>
        <p className="step-description" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>Change the primary model used by your agent.</p>

        <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Provider</label>
        <Dropdown
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
          options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
            value: p,
            label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
            icon: PROVIDER_LOGOS[p]
          }))}
        />

        {MODELS_BY_PROVIDER[provider] && (
          <div style={{ marginTop: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Model</label>
            <Dropdown
              value={model}
              onChange={(val) => setField("model", val)}
              searchable={MODELS_BY_PROVIDER[provider].length > 10}
              options={getProviderModelOptions(provider)}
            />
          </div>
        )}
        {provider === "lmstudio" && (
          <div style={{ marginTop: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>LM Studio Base URL</label>
            <input {...TEXT_ENTRY_PROPS} type="text" placeholder="http://localhost:1234/v1" value={lmstudioBaseUrl} onChange={(e) => setField("lmstudioBaseUrl", e.target.value)} />
          </div>
        )}
        {provider === "local" && (
          <div style={{ marginTop: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Custom Base URL</label>
            <input {...TEXT_ENTRY_PROPS} type="text" placeholder="http://localhost:8080/v1" value={localBaseUrl} onChange={(e) => setField("localBaseUrl", e.target.value)} />
          </div>
        )}
      </div>

      <h3 style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>Fallback Models</h3>
      <div className="mode-card-container">
        <div className={`mode-card ${enableFallbacks ? "active" : ""}`} onClick={() => setField("enableFallbacks", true)}>
          <h3>Enable Fallbacks</h3>
          <p>Chain multiple models for automatic failover.</p>
        </div>
        <div className={`mode-card ${!enableFallbacks ? "active" : ""}`} onClick={() => setField("enableFallbacks", false)}>
          <h3>No Fallbacks</h3>
          <p>Use only the primary model.</p>
        </div>
      </div>

      {enableFallbacks && (
        <>
          {[0, 1].map(idx => {
            const currentModel = fallbackModels[idx] || "";
            const currentProvider = getBaseProviderFromModel(currentModel);

            return (
              <div key={idx} className="form-group" style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px" }}>
                <label>Fallback Model {idx + 1} {idx === 1 && "(Optional)"}</label>

                {/* Provider Selection */}
                <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Provider</label>
                <Dropdown
                  value={currentProvider || ""}
                  onChange={(newProv) => {
                    if (!newProv) return;
                    const newModels = [...fallbackModels];
                    const defaultModel = getProviderDefaultModel(newProv);
                    if (defaultModel) {
                      newModels[idx] = defaultModel;
                    } else if (getProviderModelOptions(newProv).length > 0) {
                      newModels[idx] = getProviderModelOptions(newProv)[0].value;
                    }
                    setField("fallbackModels", newModels);
                  }}
                  options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                    value: p,
                    label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                    icon: PROVIDER_LOGOS[p]
                  }))}
                />

                {/* Model Selection */}
                {currentProvider && MODELS_BY_PROVIDER[currentProvider] && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Model</label>

                    {/* Ollama dynamic detection for fallback */}
                    {currentProvider === "ollama" && (
                      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                        <button
                          className="secondary"
                          style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                          disabled={ollamaDetecting}
                          onClick={async () => {
                            setField("ollamaDetecting", true);
                            try {
                              const remoteConfig = targetEnvironment === "cloud" ? {
                                ip: remoteIp, user: remoteUser,
                                password: remotePassword || null,
                                privateKeyPath: remotePrivateKeyPath || null
                              } : null;
                              const models: string[] = await invoke("get_ollama_models", { remote: remoteConfig });
                              setField("ollamaModels", models);
                              if (models.length > 0) {
                                const newModels = [...fallbackModels];
                                newModels[idx] = `ollama/${models[0]}`;
                                setField("fallbackModels", newModels);
                              }
                            } catch (e) {
                              console.error("Ollama detection failed:", e);
                            }
                            setField("ollamaDetecting", false);
                          }}
                        >
                          {ollamaDetecting ? "Detecting..." : "Detect Models"}
                        </button>
                        {ollamaModels.length > 0 && (
                          <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>
                            Found {ollamaModels.length} model(s)
                          </span>
                        )}
                      </div>
                    )}

                    {/* LM Studio dynamic detection for fallback */}
                    {currentProvider === "lmstudio" && (
                      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                        <button
                          className="secondary"
                          style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                          disabled={lmstudioDetecting}
                          onClick={async () => {
                            setField("lmstudioDetecting", true);
                            try {
                              const remoteConfig = targetEnvironment === "cloud" ? {
                                ip: remoteIp, user: remoteUser,
                                password: remotePassword || null,
                                privateKeyPath: remotePrivateKeyPath || null
                              } : null;
                              const models: string[] = await invoke("get_lmstudio_models", {
                                baseUrl: lmstudioBaseUrl,
                                remote: remoteConfig
                              });
                              const prefixedModels = models.map(m => `lmstudio/${m}`);
                              setField("lmstudioModels", prefixedModels);
                              if (prefixedModels.length > 0) {
                                const newModels = [...fallbackModels];
                                newModels[idx] = prefixedModels[0];
                                setField("fallbackModels", newModels);
                              }
                            } catch (e) {
                              console.error("LM Studio detection failed:", e);
                            }
                            setField("lmstudioDetecting", false);
                          }}
                        >
                          {lmstudioDetecting ? "Detecting..." : "Detect Models"}
                        </button>
                        {lmstudioModels.length > 0 && (
                          <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>
                            Found {lmstudioModels.length} model(s)
                          </span>
                        )}
                      </div>
                    )}

                    {/* Custom local endpoint detection for fallback */}
                    {currentProvider === "local" && (
                      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                        <button
                          className="secondary"
                          style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                          disabled={localDetecting}
                          onClick={async () => {
                            setField("localDetecting", true);
                            try {
                              const remoteConfig = targetEnvironment === "cloud" ? {
                                ip: remoteIp, user: remoteUser,
                                password: remotePassword || null,
                                privateKeyPath: remotePrivateKeyPath || null
                              } : null;
                              const models: string[] = await invoke("get_lmstudio_models", {
                                baseUrl: localBaseUrl,
                                remote: remoteConfig
                              });
                              setField("localModels", models);
                              if (models.length > 0) {
                                const newModels = [...fallbackModels];
                                newModels[idx] = `local/${models[0]}`;
                                setField("fallbackModels", newModels);
                              }
                            } catch (e) {
                              console.error("Local endpoint detection failed:", e);
                            }
                            setField("localDetecting", false);
                          }}
                        >
                          {localDetecting ? "Detecting..." : "Detect Models"}
                        </button>
                        {localModels.length > 0 && (
                          <span style={{ fontSize: "0.8rem", color: "var(--success)", alignSelf: "center" }}>
                            Found {localModels.length} model(s)
                          </span>
                        )}
                      </div>
                    )}

                    <Dropdown
                      value={currentModel}
                      onChange={(val) => {
                        const newModels = [...fallbackModels];
                        newModels[idx] = val;
                        setField("fallbackModels", newModels);
                      }}
                      searchable={MODELS_BY_PROVIDER[currentProvider].length > 10}
                      options={
                        currentProvider === "ollama" && ollamaModels.length > 0
                          ? ollamaModels.map(m => ({ value: `ollama/${m}`, label: m }))
                          : currentProvider === "lmstudio" && lmstudioModels.length > 0
                            ? lmstudioModels.map(m => ({ value: m, label: m }))
                            : currentProvider === "local" && localModels.length > 0
                              ? localModels.map(m => ({ value: `local/${m}`, label: m }))
                              : getProviderModelOptions(currentProvider)
                      }
                    />
                  </div>
                )}

                {/* Base URL for local providers */}
                {currentProvider === "lmstudio" && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>LM Studio Base URL</label>
                    <input {...TEXT_ENTRY_PROPS} type="text" placeholder="http://localhost:1234/v1" value={lmstudioBaseUrl} onChange={(e) => setField("lmstudioBaseUrl", e.target.value)} />
                  </div>
                )}
                {currentProvider === "local" && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Custom Base URL</label>
                    <input {...TEXT_ENTRY_PROPS} type="text" placeholder="http://localhost:8080/v1" value={localBaseUrl} onChange={(e) => setField("localBaseUrl", e.target.value)} />
                  </div>
                )}

              </div>
            );
          })}
        </>
      )}

      {referencedProviders.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h3 style={{ marginBottom: "0.5rem" }}>Provider Authentication</h3>
          <p className="step-description">Configure auth once for every remote provider referenced by the primary or fallback models.</p>
          {referencedProviders.map(targetProvider => renderProviderAuthEditor(targetProvider))}
        </div>
      )}

      <div className="button-group">
        <button className="primary" data-testid="btn-continue" onClick={() => setField("step", 11)}>Continue</button>
        <button className="secondary" onClick={() => setField("step", 10.5)}>Back</button>
      </div>
    </div>
  );
}

export default memo(StepModels);
