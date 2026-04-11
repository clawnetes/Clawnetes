import { memo } from "react";
import { useWizard } from "../../../context/WizardContext";

interface StepHermesReviewProps {
  handleInstall: () => void;
  hasChanges: boolean;
  initialConfigRef: React.MutableRefObject<any>;
}

function StepHermesReview({ handleInstall, hasChanges, initialConfigRef }: StepHermesReviewProps) {
  const { state, dispatch } = useWizard();
  const { loading, error, progress, logs } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as never, value });

  return (
    <div className="step-view" data-testid="step-hermes-review">
      <h2>Finalizing Hermes Installation</h2>

      <div className="status-card" style={{
        padding: "1.5rem",
        backgroundColor: hasChanges ? "rgba(59, 130, 246, 0.1)" : "rgba(34, 197, 94, 0.1)",
        border: `1px solid ${hasChanges ? "var(--primary)" : "var(--success)"}`,
        borderRadius: "12px",
        marginBottom: "2rem",
        textAlign: "center",
      }}>
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>
          {hasChanges ? (initialConfigRef.current ? "📝" : "⚕") : "✅"}
        </div>
        <h3>{hasChanges ? (initialConfigRef.current ? "Ready to Update Hermes" : "Ready to Install Hermes") : "Hermes Already Matches This Configuration"}</h3>
      </div>

      {(loading || error) && (
        <div className="progress-container" style={{ marginBottom: "2rem" }}>
          {loading && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: progress.includes("Starting") ? "80%" : (progress ? "45%" : "20%") }} />
            </div>
          )}
          <p style={{ fontSize: "0.9rem", color: error ? "var(--error)" : "var(--primary)" }}>
            {error ? "Hermes setup failed" : progress}
          </p>
          <div className="logs-container">
            <pre>{logs}</pre>
          </div>
        </div>
      )}

      <div className="button-group">
        {hasChanges ? (
          <button className="primary" data-testid="btn-finish-setup" onClick={handleInstall} disabled={loading}>
            {loading ? (initialConfigRef.current ? "Updating Hermes..." : "Installing Hermes...") : (initialConfigRef.current ? "Update Hermes" : "Finish Hermes Setup")}
          </button>
        ) : (
          <button className="primary" onClick={() => setField("step", 17)}>
            Next
          </button>
        )}
        <button className="secondary" onClick={() => setField("step", 20)} disabled={loading}>
          Back
        </button>
      </div>
    </div>
  );
}

export default memo(StepHermesReview);
