import { memo } from "react";

interface ConfigureDrawerProps {
  isOpen: boolean;
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
  isOpen,
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
  return (
    <aside className={`configure-drawer ${isOpen ? "open" : ""}`} aria-hidden={!isOpen}>
      <div className="configure-drawer-header">
        <div>
          <p className="configure-kicker">Configure</p>
          <h2>Command Center</h2>
        </div>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>

      <div className="configure-status-card">
        <p className="configure-status-label">Environment</p>
        <strong>{targetEnvironment === "cloud" ? "Remote Gateway" : "Local Gateway"}</strong>
        <p>{remoteSummary}</p>
      </div>

      <div className="configure-grid">
        <button className="configure-action-card" disabled={busy} onClick={onRepair}>
          <span>Repair System</span>
          <small>Run `openclaw doctor --repair`.</small>
        </button>
        <button className="configure-action-card" disabled={busy} onClick={onAudit}>
          <span>Security Audit</span>
          <small>Run `openclaw security audit --fix`.</small>
        </button>
        <button className="configure-action-card" disabled={busy} onClick={onUpgrade}>
          <span>Upgrade OpenClaw</span>
          <small>Update the installed OpenClaw version.</small>
        </button>
        <button className="configure-action-card" disabled={busy} onClick={onReconfigure}>
          <span>Reconfigure</span>
          <small>Return to the setup wizard with current config loaded.</small>
        </button>
        <button className="configure-action-card danger" disabled={busy} onClick={onUninstall}>
          <span>Uninstall</span>
          <small>Remove OpenClaw and local data.</small>
        </button>
      </div>

      {(maintenanceStatus || logs) && (
        <div className="configure-log-card">
          {maintenanceStatus && <p className="configure-status-text">{maintenanceStatus}</p>}
          {logs && <pre>{logs}</pre>}
        </div>
      )}
    </aside>
  );
}

export default memo(ConfigureDrawer);
