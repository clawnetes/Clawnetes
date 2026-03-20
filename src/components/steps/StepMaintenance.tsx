import { memo } from "react";
import { invoke, openExternal } from "../../lib/tauri";
import { useWizard } from "../../context/WizardContext";

interface StepMaintenanceProps {
  handleMaintenanceAction: (action: string) => void;
  loadExistingConfig: () => Promise<boolean>;
  formatSshError: (error: string) => string;
}

function StepMaintenance({ handleMaintenanceAction, loadExistingConfig, formatSshError }: StepMaintenanceProps) {
  const { state, dispatch } = useWizard();
  const {
    targetEnvironment, remoteIp, remoteUser, remotePassword, remotePrivateKeyPath,
    tunnelActive, sshStatus, selectedMaint, loading, logs,
    maintenanceStatus, maintCompleted,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view">
      <h2>Welcome Back</h2>
      <p className="step-description">
        OpenClaw is already installed {targetEnvironment === "cloud" ? `on ${remoteIp}` : "on your system"}. What would you like to do?
      </p>

      {/* Quick Action Buttons */}
      <div className="button-group" style={{ gap: "10px", marginBottom: "2rem" }}>
        <button
          className="primary"
          style={{ flex: 1 }}
          onClick={async () => {
            try {
              const url: string = await invoke("get_dashboard_url", {
                isRemote: targetEnvironment === "cloud",
                remote: targetEnvironment === "cloud" ? {
                  ip: remoteIp,
                  user: remoteUser,
                  password: remotePassword || null,
                  privateKeyPath: remotePrivateKeyPath || null
                } : null
              });
              await openExternal(url);
            } catch (e) {
              setField("maintenanceStatus", `❌ Failed to get dashboard URL: ${e}`);
            }
          }}
          disabled={targetEnvironment === "cloud" && !tunnelActive}
        >
          🌐 Open Dashboard
        </button>

        {targetEnvironment === "cloud" && (
          <button
            className="secondary"
            style={{ flex: 1 }}
            onClick={async () => {
              if (tunnelActive) {
                // Stop tunnel
                try {
                  await invoke("stop_ssh_tunnel");
                  setField("tunnelActive", false);
                  setField("maintenanceStatus", "✅ SSH tunnel stopped.");
                } catch (e) {
                  setField("maintenanceStatus", `❌ Failed to stop tunnel: ${e}`);
                }
              } else {
                // Start tunnel - check if we have SSH config
                if (!remoteIp || !remoteUser) {
                  setField("maintenanceStatus", "❌ SSH configuration missing. Please reconfigure to set up remote connection.");
                  return;
                }

                try {
                  // Test connection first if not already successful
                  if (sshStatus !== "success") {
                    setField("maintenanceStatus", "Testing SSH connection...");
                    await invoke("test_ssh_connection", {
                      remote: {
                        ip: remoteIp,
                        user: remoteUser,
                        password: remotePassword || null,
                        privateKeyPath: remotePrivateKeyPath || null
                      }
                    });
                    setField("sshStatus", "success");
                  }

                  // Establish tunnel
                  setField("maintenanceStatus", "Establishing SSH tunnel...");
                  await invoke("start_ssh_tunnel", {
                    remote: {
                      ip: remoteIp,
                      user: remoteUser,
                      password: remotePassword || null,
                      privateKeyPath: remotePrivateKeyPath || null
                    }
                  });
                  setField("tunnelActive", true);
                  setField("maintenanceStatus", "✅ SSH tunnel established successfully. Dashboard is now accessible.");
                } catch (e) {
                  const friendlyError = formatSshError(String(e));
                  setField("maintenanceStatus", `❌ Failed to establish tunnel: ${friendlyError}`);
                  setField("sshStatus", "idle");
                }
              }
            }}
          >
            {tunnelActive ? "🔓 Stop SSH Tunnel" : "🔒 Establish SSH Tunnel"}
          </button>
        )}
      </div>

      {/* Maintenance Options */}
      <h3 style={{ marginBottom: "1rem" }}>Maintenance Options</h3>
      <div className="mode-card-container" style={{ gridTemplateColumns: "1fr", gap: "1rem" }}>
        <div
          className={`mode-card ${selectedMaint === "repair" ? "active" : ""}`}
          onClick={() => !loading && setField("selectedMaint", "repair")}
        >
          <h3>🛠 Repair System</h3>
          <p>Run <code>openclaw doctor --repair</code> to fix configuration and service issues.</p>
        </div>

        <div
          className={`mode-card ${selectedMaint === "audit" ? "active" : ""}`}
          onClick={() => !loading && setField("selectedMaint", "audit")}
        >
          <h3>🛡 Security Audit</h3>
          <p>Run <code>openclaw security audit --fix</code> to audit and tighten system permissions.</p>
        </div>

        <div
          className={`mode-card ${selectedMaint === "update" ? "active" : ""}`}
          onClick={() => !loading && setField("selectedMaint", "update")}
        >
          <h3>🚀 Upgrade OpenClaw Version</h3>
          <p>Upgrade to the latest version of OpenClaw.</p>
        </div>

        <div
          className={`mode-card ${selectedMaint === "reconfigure" ? "active" : ""}`}
          onClick={() => !loading && setField("selectedMaint", "reconfigure")}
        >
          <h3>⚙️ Reconfigure OpenClaw</h3>
          <p>Proceed to the standard setup wizard to re-configure your agent and channels.</p>
        </div>

        <div
          className={`mode-card ${selectedMaint === "uninstall" ? "active" : ""}`}
          style={selectedMaint === "uninstall" ? { borderColor: "var(--error)", backgroundColor: "rgba(239, 68, 68, 0.05)" } : {}}
          onClick={() => !loading && setField("selectedMaint", "uninstall")}
        >
          <h3 style={selectedMaint === "uninstall" ? { color: "var(--error)" } : {}}>🗑 Uninstall Completely</h3>
          <p>Remove the OpenClaw CLI and all {targetEnvironment === "local" ? "local" : "remote"} configuration/data files.</p>
        </div>
      </div>

      {!loading && (
        <div className="button-group" style={{ gap: "10px", marginTop: "1.5rem" }}>
          <button
            className="primary"
            style={{ flex: 1 }}
            onClick={async () => {
              if (selectedMaint === "reconfigure") {
                // Load existing config first
                const loaded = await loadExistingConfig();
                if (loaded) {
                  setField("mode", "advanced");
                  setField("step", 6);
                }
              } else if (selectedMaint === "uninstall") {
                if (confirm("Are you absolutely sure you want to completely remove OpenClaw and all its data?")) {
                  handleMaintenanceAction("uninstall");
                }
              } else if (selectedMaint) {
                handleMaintenanceAction(selectedMaint);
              }
            }}
            disabled={!selectedMaint}
          >
            Confirm Action
          </button>
          {maintCompleted && (
            <button className="secondary" style={{ flex: 1 }} onClick={() => invoke("close_app")}>Exit Setup</button>
          )}
        </div>
      )}

      {maintenanceStatus && (
        <div className="progress-container" style={{ marginTop: "2rem" }}>
          <p style={{ fontSize: "0.9rem", color: maintenanceStatus.includes("❌") ? "var(--error)" : maintenanceStatus.includes("✅") ? "var(--success)" : "var(--primary)" }}>{maintenanceStatus}</p>
          <div className="logs-container">
            <pre>{logs}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(StepMaintenance);
