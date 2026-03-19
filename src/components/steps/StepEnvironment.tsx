import { open as openDialog } from "@tauri-apps/api/dialog";
import { useWizard } from "../../context/WizardContext";

interface StepEnvironmentProps {
  handleSshCheck: () => void;
  checkSystem: (silent: boolean) => Promise<boolean>;
  checkRemoteSystem: (silent: boolean) => Promise<boolean>;
}

export default function StepEnvironment({ handleSshCheck, checkSystem, checkRemoteSystem }: StepEnvironmentProps) {
  const { state, dispatch } = useWizard();
  const {
    targetEnvironment, remoteIp, remoteUser, remotePassword, remotePrivateKeyPath,
    sshStatus, sshError,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view" data-testid="step-environment">
      <h2>Target Environment</h2>
      <p className="step-description">Where will you be running OpenClaw?</p>
      <div className="mode-card-container">
        <div className={`mode-card ${targetEnvironment === "local" ? "active" : ""}`} onClick={() => {
          setField("targetEnvironment", "local");
          setField("sshStatus", "idle");
        }}>
          <h3>💻 Local Machine</h3>
          <p>Run OpenClaw directly on your computer (macOS/Linux/Windows)</p>
        </div>
        <div className={`mode-card ${targetEnvironment === "cloud" ? "active" : ""}`} onClick={() => setField("targetEnvironment", "cloud")}>
          <h3>☁️ Cloud Server</h3>
          <p>Deploy to a cloud VM (AWS, GCP, Azure, etc.)</p>
        </div>
      </div>

      {targetEnvironment === "cloud" && (
        <div className="remote-config" style={{ marginTop: "2rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>SSH Configuration</h3>
          <div className="form-group">
            <label>Server IP Address</label>
            <input
              data-testid="input-remote-ip"
              placeholder="192.168.1.100"
              value={remoteIp}
              onChange={(e) => setField("remoteIp", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>SSH Username</label>
            <input
              data-testid="input-remote-user"
              placeholder="ubuntu"
              value={remoteUser}
              onChange={(e) => setField("remoteUser", e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
          </div>
          <div className="form-group">
            <label>SSH Private Key (Optional)</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                data-testid="input-remote-key"
                placeholder="/Users/you/.ssh/id_rsa"
                value={remotePrivateKeyPath}
                onChange={(e) => setField("remotePrivateKeyPath", e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="secondary"
                onClick={async () => {
                  const path = await openDialog({
                    title: "Select SSH Private Key",
                    directory: false,
                    multiple: false,
                    defaultPath: "~/.ssh",
                  });
                  if (path && typeof path === "string") {
                    setField("remotePrivateKeyPath", path);
                  }
                }}
              >
                Browse
              </button>
            </div>
            <p className="input-hint">Leave empty to use default keys (~/.ssh/id_rsa, id_ed25519) or SSH agent</p>
          </div>
          <div className="form-group">
            <label>SSH Password (if not using key)</label>
            <input
              data-testid="input-remote-password"
              type="password"
              placeholder="Password"
              value={remotePassword}
              onChange={(e) => setField("remotePassword", e.target.value)}
            />
          </div>

          <button
            data-testid="btn-test-connection"
            className="secondary"
            onClick={handleSshCheck}
            disabled={!remoteIp || !remoteUser || sshStatus === "checking"}
            style={{ width: "100%", marginTop: "1rem" }}
          >
            {sshStatus === "checking" ? "Testing..." : "Test Connection"}
          </button>

          {sshStatus === "success" && (
            <div style={{ marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(34, 197, 94, 0.1)", borderRadius: "8px", border: "1px solid rgba(34, 197, 94, 0.3)" }}>
              <strong style={{ color: "rgb(34, 197, 94)" }}>✅ Success:</strong> <span style={{ color: "var(--text)" }}>SSH connection established successfully!</span>
            </div>
          )}

          {sshError && (
            <div className="error" style={{ marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
              <strong style={{ color: "rgb(239, 68, 68)" }}>❌ Error:</strong> <span style={{ color: "var(--text)" }}>{sshError}</span>
            </div>
          )}
        </div>
      )}

      <div className="button-group" style={{ marginTop: "2rem" }}>
        <button
          className="primary"
          onClick={async () => {
            if (targetEnvironment === "cloud") {
              const redirected = await checkRemoteSystem(false);
              if (!redirected) {
                setField("step", 2);
              }
            } else {
              const redirected = await checkSystem(false);
              if (!redirected) {
                setField("step", 2);
              }
            }
          }}
          disabled={targetEnvironment === "cloud" && sshStatus !== "success"}
          data-testid="btn-continue"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
