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
  const { provider, model, loading } = state;

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

      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" data-testid="btn-next" onClick={() => setField("step", 20)} disabled={loading}>
          Next
        </button>
        <button className="secondary" onClick={() => setField("step", 18)} disabled={loading}>
          Back
        </button>
      </div>
    </div>
  );
}
