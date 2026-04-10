import type { ReactNode } from "react";
import { useWizard } from "../../../context/WizardContext";
import Dropdown from "../../Dropdown";
import { MODELS_BY_PROVIDER, PROVIDER_LOGOS } from "../../../presets/modelsByProvider";

interface StepHermesConfigProps {
  renderProviderAuthEditor: (provider: string, options?: { keyPrefix?: string; showProviderLabel?: boolean; marginTop?: string }) => ReactNode;
  getProviderDefaultModel: (provider: string) => string;
  getProviderModelOptions: (provider: string) => { value: string; label: string }[];
}

export default function StepHermesConfig({
  renderProviderAuthEditor,
  getProviderDefaultModel,
  getProviderModelOptions,
}: StepHermesConfigProps) {
  const { state, dispatch } = useWizard();
  const {
    provider,
    model,
    loading,
    hermesModelBaseUrl,
    hermesTerminalBackend,
    hermesMaxTurns,
    hermesReasoningEffort,
    hermesPersonality,
    hermesApiServerKey,
    hermesApiServerCorsOrigins,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as never, value });

  return (
    <div className="step-view" data-testid="step-hermes-config">
      <h2>Hermes Configuration</h2>
      <p className="step-description">
        Configure the Hermes runtime provider and model that Clawnetes will manage through the Hermes API server.
      </p>

      <div className="form-group">
        <label>Runtime Provider</label>
        <Dropdown
          testId="dropdown-hermes-provider"
          value={provider}
          onChange={(nextProvider) => {
            setField("provider", nextProvider);
            const defaultModel = getProviderDefaultModel(nextProvider);
            if (defaultModel) {
              setField("model", defaultModel);
            }
          }}
          options={Object.keys(MODELS_BY_PROVIDER).map((providerId) => ({
            value: providerId,
            label: providerId === "google" ? "Google Gemini" : providerId.charAt(0).toUpperCase() + providerId.slice(1),
            icon: PROVIDER_LOGOS[providerId],
          }))}
        />
      </div>

      {renderProviderAuthEditor(provider, {
        keyPrefix: "hermes-provider",
        showProviderLabel: false,
        marginTop: "1.25rem",
      })}

      <div className="form-group" style={{ marginTop: "1.25rem" }}>
        <label>Model</label>
        <Dropdown
          testId="dropdown-hermes-model"
          value={model}
          onChange={(nextModel) => setField("model", nextModel)}
          searchable={(MODELS_BY_PROVIDER[provider]?.length || 0) > 10}
          options={getProviderModelOptions(provider)}
        />
      </div>

      <div className="form-group" style={{ marginTop: "1.25rem" }}>
        <label htmlFor="hermes-model-base-url">Model Base URL</label>
        <input
          id="hermes-model-base-url"
          aria-label="Model Base URL"
          type="text"
          placeholder="https://api.openai.com/v1"
          value={hermesModelBaseUrl}
          onChange={(event) => setField("hermesModelBaseUrl", event.target.value)}
        />
      </div>

      <div className="form-group" style={{ marginTop: "1.25rem" }}>
        <label htmlFor="hermes-terminal-backend">Terminal Backend</label>
        <select
          id="hermes-terminal-backend"
          aria-label="Terminal Backend"
          value={hermesTerminalBackend}
          onChange={(event) => setField("hermesTerminalBackend", event.target.value)}
        >
          <option value="local">Local</option>
          <option value="docker">Docker</option>
          <option value="ssh">SSH</option>
        </select>
      </div>

      <div className="form-group" style={{ marginTop: "1.25rem" }}>
        <label htmlFor="hermes-max-turns">Max Turns</label>
        <input
          id="hermes-max-turns"
          type="number"
          value={hermesMaxTurns}
          onChange={(event) => setField("hermesMaxTurns", Number.parseInt(event.target.value, 10) || 0)}
        />
      </div>

      <div className="form-group" style={{ marginTop: "1.25rem" }}>
        <label htmlFor="hermes-reasoning-effort">Reasoning Effort</label>
        <select
          id="hermes-reasoning-effort"
          value={hermesReasoningEffort}
          onChange={(event) => setField("hermesReasoningEffort", event.target.value)}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <div className="form-group" style={{ marginTop: "1.25rem" }}>
        <label htmlFor="hermes-personality">Personality</label>
        <select
          id="hermes-personality"
          value={hermesPersonality}
          onChange={(event) => setField("hermesPersonality", event.target.value)}
        >
          <option value="helpful">Helpful</option>
          <option value="concise">Concise</option>
          <option value="technical">Technical</option>
          <option value="creative">Creative</option>
        </select>
      </div>

      <div className="form-group" style={{ marginTop: "1.25rem" }}>
        <label htmlFor="hermes-api-server-key">API Server Key</label>
        <input
          id="hermes-api-server-key"
          aria-label="API Server Key"
          type="password"
          value={hermesApiServerKey}
          onChange={(event) => setField("hermesApiServerKey", event.target.value)}
        />
      </div>

      <div className="form-group" style={{ marginTop: "1.25rem" }}>
        <label htmlFor="hermes-api-server-cors">API Server CORS Origins</label>
        <input
          id="hermes-api-server-cors"
          type="text"
          value={hermesApiServerCorsOrigins}
          onChange={(event) => setField("hermesApiServerCorsOrigins", event.target.value)}
        />
      </div>

      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" data-testid="btn-next" onClick={() => setField("step", 20)} disabled={loading}>
          Next
        </button>
        <button className="secondary" onClick={() => setField("step", 3)} disabled={loading}>
          Back
        </button>
      </div>
    </div>
  );
}
