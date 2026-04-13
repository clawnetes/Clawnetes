import { useWizard } from "../../context/WizardContext";
import { PLATFORM_CAPABILITIES } from "../../platforms";

export default function StepPlatformSelect() {
  const { state, dispatch, onSwitchPlatform } = useWizard();
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
            onClick={() => {
              if (onSwitchPlatform) {
                onSwitchPlatform(option.id);
                return;
              }
              setField("platform", option.id);
            }}
            style={{
              padding: "2rem",
              borderRadius: "12px",
              border: platform === option.id ? "2px solid var(--primary)" : "1px solid var(--border)",
              backgroundColor: platform === option.id ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
              minHeight: "180px",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "1.2rem" }}>{option.label}</div>
            {option.id === "openclaw" ? (
              <>
                <img src="/images/openclaw.svg" alt="OpenClaw Logo" className="theme-dark-logo" style={{ width: "160px", height: "auto", objectFit: "contain" }} />
                <img src="/images/openclaw-light.svg" alt="OpenClaw Logo" className="theme-light-logo" style={{ width: "160px", height: "auto", objectFit: "contain" }} />
              </>
            ) : (
              <div style={{ fontSize: "64px", lineHeight: 1 }}>⚕️</div>
            )}
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
