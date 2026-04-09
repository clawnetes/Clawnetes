import { useWizard } from "../../context/WizardContext";
import { PLATFORM_CAPABILITIES } from "../../platforms";

export default function StepPlatformSelect() {
  const { state, dispatch } = useWizard();
  const { platform } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as never, value });

  return (
    <div className="step-view" data-testid="step-platform-select">
      <h2>Agent Platform</h2>
      <p className="step-description">Choose which agent runtime this environment will use.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        {PLATFORM_CAPABILITIES.map((option) => (
          <div
            key={option.id}
            data-testid={`platform-card-${option.id}`}
            className={`mode-card ${platform === option.id ? "active" : ""}`}
            onClick={() => setField("platform", option.id)}
            style={{
              padding: "1.25rem",
              borderRadius: "12px",
              border: platform === option.id ? "2px solid var(--primary)" : "1px solid var(--border)",
              backgroundColor: platform === option.id ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>{option.label}</div>
            <div style={{ fontSize: "0.9rem", marginBottom: "0.35rem", color: "var(--text-primary)" }}>{option.description}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{option.helperText}</div>
          </div>
        ))}
      </div>

      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" data-testid="btn-next" onClick={() => setField("step", 1)}>
          Continue
        </button>
      </div>
    </div>
  );
}
