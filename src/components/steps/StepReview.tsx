import { memo } from "react";
import { invoke } from "../../lib/tauri";
import { useWizard } from "../../context/WizardContext";

interface StepReviewProps {
  handleInstall: () => void;
  hasChanges: boolean;
  initialConfigRef: React.MutableRefObject<any>;
}

function StepReview({ handleInstall, hasChanges, initialConfigRef }: StepReviewProps) {
  const { state, dispatch } = useWizard();
  const {
    loading, error, progress, logs, mode,
    targetEnvironment, remoteIp, remoteUser, remotePassword, remotePrivateKeyPath,
    validating, validateOutput,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view" data-testid="step-review">
      <h2>{initialConfigRef.current ? "Review Configuration" : "Deploy Your AI Agent"}</h2>
      <p className="step-description">{initialConfigRef.current ? "Review your changes before applying." : "Your agent is ready to be deployed."}</p>

      <div className="status-card" style={{
        padding: "1.5rem",
        backgroundColor: hasChanges ? "rgba(59, 130, 246, 0.1)" : "rgba(34, 197, 94, 0.1)",
        border: `1px solid ${hasChanges ? "var(--primary)" : "var(--success)"}`,
        borderRadius: "12px",
        marginBottom: "2rem",
        textAlign: "center"
      }}>
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>
          {hasChanges ? (initialConfigRef.current ? "📝" : "🚀") : "✅"}
        </div>
        <h3>{hasChanges ? (initialConfigRef.current ? "Configuration Updated" : "Ready to Deploy") : "No Changes Detected"}</h3>
        <p style={{ color: "var(--text-muted)" }}>
          {hasChanges
            ? (initialConfigRef.current ? "You have modified the agent configuration. Click below to apply these changes." : "Your configuration is complete. Click below to deploy your agent.")
            : "Your configuration matches the current active settings."}
        </p>
      </div>

      {(loading || error) && (
        <div className="progress-container" style={{ marginBottom: "2rem" }}>
          {loading && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: progress.includes("Gateway") ? "80%" : (progress.includes("skill") ? "50%" : "20%") }} />
            </div>
          )}
          <p style={{ fontSize: "0.9rem", color: error ? "var(--error)" : "var(--primary)" }}>{error ? "Installation Failed" : progress}</p>
          <div className="logs-container">
            <pre>{logs}</pre>
          </div>
        </div>
      )}

      {initialConfigRef.current && (
        <div style={{ marginBottom: "1.5rem" }}>
          <button
            className="secondary"
            style={{ width: "100%", marginBottom: "0.5rem" }}
            disabled={validating}
            onClick={async () => {
              setField("validating", true);
              setField("validateOutput", "");
              try {
                const remoteConfig = targetEnvironment === "cloud" ? {
                  ip: remoteIp, user: remoteUser,
                  password: remotePassword || null,
                  privateKeyPath: remotePrivateKeyPath || null
                } : null;
                const output: string = await invoke("validate_openclaw_config", {
                  remote: remoteConfig,
                  isWsl: false
                });
                setField("validateOutput", output || "Config is valid.");
              } catch (e: any) {
                setField("validateOutput", `Validation error: ${e}`);
              }
              setField("validating", false);
            }}
          >
            {validating ? "Validating..." : "Validate Config"}
          </button>
          {validateOutput && (
            <div className="logs-container">
              <pre style={{ fontSize: "0.8rem" }}>{validateOutput}</pre>
            </div>
          )}
        </div>
      )}

      <div className="button-group">
        {hasChanges ? (
          <button className="primary" data-testid="btn-finish-setup" onClick={handleInstall} disabled={loading}>
            {loading ? (initialConfigRef.current ? "Updating..." : "Installing...") : (initialConfigRef.current ? "Update Configuration" : "Finish Setup")}
          </button>
        ) : (
          <button className="primary" onClick={() => setField("step", 17)}>
            Next
          </button>
        )}
        <button className="secondary" onClick={() => setField("step", mode === "advanced" ? 15.7 : 9)} disabled={loading}>Back</button>
      </div>
    </div>
  );
}

export default memo(StepReview);
