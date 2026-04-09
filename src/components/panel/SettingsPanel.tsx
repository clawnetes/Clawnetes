import { memo, useState } from "react";
import Badge from "../ui/Badge";
import type { AgentPlatform } from "../../platforms/types";

interface SettingsPanelProps {
  platform?: AgentPlatform;
  targetEnvironment?: string;
  remoteSummary?: string;
  gatewayPort?: number;
  gatewayBind?: string;
  gatewayAuthMode?: string;
  heartbeatMode?: string;
  sandboxMode?: string;
  busy?: boolean;
  maintenanceStatus?: string;
  onRepair?: () => void;
  onAudit?: () => void;
  onUpgrade?: () => void;
  onReconfigure?: () => void;
  onUninstall?: () => void;
  idleTimeoutMs?: number;
  onSaveAgentSettings?: (heartbeatMode: string, idleTimeoutMs: number, sandboxMode: string) => void;
}

function SettingItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[0.65rem] text-[var(--text-muted)]">{label}</span>
      <span className="text-xs font-medium text-[var(--text-main)]">{value || "—"}</span>
    </div>
  );
}

function ActionButton({
  label,
  description,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-label={label}
      className={`w-full text-center p-3 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger
          ? "border-error/30 hover:bg-error/5 hover:border-error/50"
          : "border-[var(--border)] hover:bg-[var(--surface-hover)]"
      }`}
      data-testid={`settings-action-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span
        className="flex flex-col items-center gap-0.5"
        data-testid={`settings-action-content-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span
          className={`text-xs font-semibold leading-tight ${danger ? "text-error" : "text-[var(--text-main)]"}`}
          data-testid={`settings-action-label-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {label}
        </span>
        <span
          className="text-[0.6rem] leading-tight text-[var(--text-muted)]"
          data-testid={`settings-action-description-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {description}
        </span>
      </span>
    </button>
  );
}

function SettingsPanel({
  platform = "openclaw",
  targetEnvironment = "local",
  remoteSummary = "",
  gatewayPort,
  gatewayBind,
  gatewayAuthMode,
  heartbeatMode = "never",
  sandboxMode = "none",
  busy = false,
  maintenanceStatus,
  onRepair,
  onAudit,
  onUpgrade,
  onReconfigure,
  onUninstall,
  idleTimeoutMs = 0,
  onSaveAgentSettings,
}: SettingsPanelProps) {
  const envLabel = targetEnvironment === "cloud" ? "Remote Gateway" : "Local Gateway";
  const [draftHeartbeatMode, setDraftHeartbeatMode] = useState(heartbeatMode);
  const [draftIdleTimeout, setDraftIdleTimeout] = useState(idleTimeoutMs);
  const [draftSandboxMode, setDraftSandboxMode] = useState(sandboxMode);
  const [draftTerminalBackend, setDraftTerminalBackend] = useState("local");
  const [settingsDirty, setSettingsDirty] = useState(false);

  const handleHeartbeatChange = (mode: string) => {
    setDraftHeartbeatMode(mode);
    setSettingsDirty(true);
  };

  const handleIdleTimeoutChange = (timeout: number) => {
    setDraftIdleTimeout(timeout);
    setSettingsDirty(true);
  };

  const handleSandboxModeChange = (mode: string) => {
    setDraftSandboxMode(mode);
    setSettingsDirty(true);
  };

  const handleTerminalBackendChange = (mode: string) => {
    setDraftTerminalBackend(mode);
    setSettingsDirty(true);
  };

  const handleSaveSettings = () => {
    if (onSaveAgentSettings) {
      onSaveAgentSettings(draftHeartbeatMode, draftIdleTimeout, draftSandboxMode);
      setSettingsDirty(false);
    }
  };

  const isHermes = platform === "hermes";
  const platformName = isHermes ? "Hermes Agent" : "OpenClaw";

  return (
    <div data-testid="settings-panel" className="space-y-5">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">Settings</h3>

      {/* Environment section */}
      <div>
        <h4 className="text-[0.65rem] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-2">
          Environment
        </h4>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-[var(--text-main)]">{envLabel} ({platformName})</span>
            <Badge variant="connected">Active</Badge>
          </div>
          {remoteSummary && (
            <p className="text-[0.65rem] text-[var(--text-muted)]">{remoteSummary}</p>
          )}
        </div>
      </div>

      {/* Gateway section */}
      <div>
        <h4 className="text-[0.65rem] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-2">
          Gateway
        </h4>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 divide-y divide-[var(--border)]">
          <SettingItem label="Port" value={gatewayPort ? String(gatewayPort) : undefined} />
          <SettingItem label="Bind Address" value={gatewayBind} />
          {!isHermes && <SettingItem label="Auth Mode" value={gatewayAuthMode} />}
        </div>
      </div>

      {/* Hermes Session section */}
      {isHermes && (
        <div>
          <h4 className="text-[0.65rem] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-2">
            Execution Environment
          </h4>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-[var(--text-main)] block mb-1">
                Terminal Backend
              </label>
              <select
                value={draftTerminalBackend}
                onChange={(e) => handleTerminalBackendChange(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[var(--surface-hover)] border border-[var(--surface-border)] text-xs text-[var(--text-main)]"
              >
                <option value="local">Local (Host OS)</option>
                <option value="docker">Docker Container</option>
                <option value="flyio">Fly.io (Cloud)</option>
              </select>
              <p className="text-[0.6rem] text-[var(--text-muted)] mt-1.5">
                Controls where Hermes executes shell commands and writes files.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Session section - Editable */}
      {!isHermes && (
        <div>
          <h4 className="text-[0.65rem] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-2">
            Session
          </h4>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-[var(--text-main)] block mb-1">
                Heartbeat Mode
              </label>
              <select
                value={draftHeartbeatMode}
                onChange={(e) => handleHeartbeatChange(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[var(--surface-hover)] border border-[var(--surface-border)] text-xs text-[var(--text-main)]"
              >
                <option value="never">Never</option>
                <option value="30m">Every 30 minutes</option>
                <option value="1h">Every hour</option>
                <option value="6h">Every 6 hours</option>
                <option value="idle">When idle</option>
              </select>
            </div>

            {draftHeartbeatMode === "idle" && (
              <div>
                <label className="text-xs font-medium text-[var(--text-main)] block mb-1">
                  Idle Timeout (ms)
                </label>
                <input
                  type="number"
                  value={draftIdleTimeout}
                  onChange={(e) => handleIdleTimeoutChange(parseInt(e.target.value, 10))}
                  className="w-full px-2 py-1.5 rounded bg-[var(--surface-hover)] border border-[var(--surface-border)] text-xs text-[var(--text-main)]"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-[var(--text-main)] block mb-1">
                Sandbox Mode
              </label>
              <select
                value={draftSandboxMode}
                onChange={(e) => handleSandboxModeChange(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[var(--surface-hover)] border border-[var(--surface-border)] text-xs text-[var(--text-main)]"
              >
                <option value="none">None</option>
                <option value="partial">Partial (sub-agents only)</option>
                <option value="full">Full</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Save button if settings are dirty */}
      {settingsDirty && onSaveAgentSettings && !isHermes && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDraftHeartbeatMode(heartbeatMode);
              setDraftIdleTimeout(idleTimeoutMs);
              setDraftSandboxMode(sandboxMode);
              setSettingsDirty(false);
            }}
            className="flex-1 px-3 py-2 rounded-md bg-[var(--surface-hover)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-active)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-md bg-[var(--accent)] text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity disabled:cursor-not-allowed"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      )}

      {/* Maintenance actions */}
      <div>
        <h4 className="text-[0.65rem] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-2">
          Maintenance
        </h4>
        {maintenanceStatus && (
          <p className="text-[0.65rem] text-[var(--accent)] mb-2">{maintenanceStatus}</p>
        )}
        <div className="space-y-2">
          <ActionButton
            label="Repair System"
            description={isHermes ? "Run hermes doctor" : "Run openclaw doctor --repair"}
            onClick={onRepair}
            disabled={busy}
          />
          {!isHermes && (
            <ActionButton
              label="Security Audit"
              description="Run openclaw security audit --fix"
              onClick={onAudit}
              disabled={busy}
            />
          )}
          <ActionButton
            label={`Upgrade ${platformName}`}
            description={`Update the installed ${platformName} version`}
            onClick={onUpgrade}
            disabled={busy}
          />
          <ActionButton
            label="Reconfigure"
            description="Return to the setup wizard with current config"
            onClick={onReconfigure}
            disabled={busy}
          />
          <ActionButton
            label="Uninstall"
            description={`Remove ${platformName} and local data`}
            onClick={onUninstall}
            disabled={busy}
            danger
          />
        </div>
      </div>
    </div>
  );
}

export default memo(SettingsPanel);
