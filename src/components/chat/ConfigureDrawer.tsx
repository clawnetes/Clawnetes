import { memo } from "react";

interface ConfigureDrawerProps {
  busy: boolean;
  maintenanceStatus: string;
  logs: string;
  targetEnvironment: string;
  remoteSummary: string;
  onClose: () => void;
  onRepair: () => void;
  onAudit: () => void;
  onUpgrade: () => void;
  onReconfigure: () => void;
  onUninstall: () => void;
}

function ConfigureDrawer({
  busy,
  maintenanceStatus,
  logs,
  targetEnvironment,
  remoteSummary,
  onClose,
  onRepair,
  onAudit,
  onUpgrade,
  onReconfigure,
  onUninstall,
}: ConfigureDrawerProps) {
  const showLogs = busy || Boolean(maintenanceStatus) || Boolean(logs.trim());

  return (
    <section className="command-center-screen" data-testid="command-center-screen">
      <div className="command-center-shell">
        <div className="configure-drawer-header">
          <button className="secondary command-center-back" onClick={onClose} type="button">
            ← Back to app
          </button>
        </div>

        <div className="command-center-intro">
          <p className="configure-kicker">Configure</p>
          <h2>Command Center</h2>
        </div>

        <div className="configure-status-card">
          <p className="configure-status-label">Environment</p>
          <strong>{targetEnvironment === "cloud" ? "Remote Gateway" : "Local Gateway"}</strong>
          <p>{remoteSummary}</p>
        </div>

        <div className="configure-grid">
          <button className="configure-action-card" disabled={busy} onClick={onRepair} type="button">
            <span>Repair System</span>
            <small>Run `openclaw doctor --repair`.</small>
          </button>
          <button className="configure-action-card" disabled={busy} onClick={onAudit} type="button">
            <span>Security Audit</span>
            <small>Run `openclaw security audit --fix`.</small>
          </button>
          <button className="configure-action-card" disabled={busy} onClick={onUpgrade} type="button">
            <span>Upgrade OpenClaw</span>
            <small>Update the installed OpenClaw version.</small>
          </button>
          <button className="configure-action-card" disabled={busy} onClick={onReconfigure} type="button">
            <span>Reconfigure</span>
            <small>Return to the setup wizard with current config loaded.</small>
          </button>
          <button className="configure-action-card danger" disabled={busy} onClick={onUninstall} type="button">
            <span>Uninstall</span>
            <small>Remove OpenClaw and local data.</small>
          </button>
        </div>

        {showLogs && (
          <div className="configure-log-card">
            {maintenanceStatus && <p className="configure-status-text">{maintenanceStatus}</p>}
            {logs && <pre>{logs}</pre>}
          </div>
        )}
      </div>
    </section>
  );
}

export default memo(ConfigureDrawer);
