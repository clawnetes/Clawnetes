import { useWizard } from "../../context/WizardContext";

interface StepSystemCheckProps {
  installLocalNode: () => void;
}

export default function StepSystemCheck({ installLocalNode }: StepSystemCheckProps) {
  const { state, dispatch } = useWizard();
  const { targetEnvironment, remoteIp, platform, checks, installingNode, nodeInstallError } = state;
  const platformLabel = platform === "hermes" ? "Hermes Agent" : "OpenClaw";

  const setStep = (v: number) => dispatch({ type: "SET_FIELD", field: "step", value: v });

  return (
    <div className="step-view" data-testid="step-system-check">
      <h2>System Check</h2>
      <p className="step-description">
        {targetEnvironment === "cloud"
          ? `Checking remote server (${remoteIp})...`
          : `We need to make sure your system is ready for ${platformLabel}.`}
      </p>
      <div className="check-item">
        <span className="check-status">{checks.node ? "✅" : "❌"}</span>
        Node.js {checks.node ? "detected" : "not found"} {targetEnvironment === "cloud" && `(on ${remoteIp})`}
      </div>
      <div className="check-item">
        <span className="check-status">{checks.openclaw ? "✅" : "⏳"}</span>
        {platformLabel} {checks.openclaw ? "Installed" : "Ready to install"} {targetEnvironment === "cloud" && `(on ${remoteIp})`}
      </div>
      {!checks.node && (
        <div className="error" style={{ marginTop: "1rem", color: "var(--error)" }}>
          <p>Node.js is required.</p>
          {targetEnvironment === "local" && (
            <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "5px" }}>
              <button
                className="secondary small"
                onClick={installLocalNode}
                disabled={installingNode}
                style={{ padding: "4px 10px", fontSize: "0.8rem", cursor: "pointer" }}
              >
                {installingNode ? "Installing..." : "Install Now"}
              </button>
              {nodeInstallError && <span style={{ fontSize: "0.8rem" }}>{nodeInstallError}</span>}
            </div>
          )}
          {targetEnvironment === "cloud" && (
            <p>It will be installed automatically in the Setup step.</p>
          )}
        </div>
      )}
      <div className="button-group">
        <button
          className="primary"
          disabled={targetEnvironment === "local" && !checks.node}
          onClick={() => setStep(3)}
          data-testid="btn-continue"
        >
          Continue
        </button>
        <button className="secondary" onClick={() => setStep(1)}>Back</button>
      </div>
    </div>
  );
}
