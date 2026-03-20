import { useWizard } from "../../context/WizardContext";
import Dropdown from "../Dropdown";

export default function StepExtraSettings() {
  const { state, dispatch } = useWizard();
  const {
    gatewayPort, gatewayBind, gatewayAuthMode, tailscaleMode,
    nodeManager, sandboxMode, heartbeatMode, idleTimeoutMs,
    extraSettingsOpen, enableMultiAgent,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view" data-testid="step-extra-settings">
      <h2>Extra Settings</h2>
      <p className="step-description">Configure advanced gateway, runtime, security, and session settings.</p>

      {/* Gateway Settings */}
      <div className="accordion-section" style={{ marginBottom: "1rem" }}>
        <button
          className="accordion-header"
          onClick={() => setField("extraSettingsOpen", { ...extraSettingsOpen, gateway: !extraSettingsOpen.gateway })}
          style={{
            width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "1rem", background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: extraSettingsOpen.gateway ? "12px 12px 0 0" : "12px",
            cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
          }}
        >
          <span>Gateway Settings</span>
          <span className={`accordion-chevron ${extraSettingsOpen.gateway ? "rotated" : ""}`}>▼</span>
        </button>
        {extraSettingsOpen.gateway && (
          <div style={{ padding: "1rem", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 12px 12px", background: "var(--bg-card)" }}>
            <div className="form-group">
              <label>Port</label>
              <input type="number" value={gatewayPort} onChange={(e) => setField("gatewayPort", parseInt(e.target.value))} />
            </div>
            <div className="form-group" style={{ marginTop: "1rem" }}>
              <label>Bind Address</label>
              <Dropdown value={gatewayBind} onChange={(v) => setField("gatewayBind", v)} options={[
                { value: "loopback", label: "Loopback (127.0.0.1)", description: "Only accessible from this machine" },
                { value: "all", label: "All Interfaces (0.0.0.0)", description: "Accessible from local network" }
              ]} />
            </div>
            <div className="form-group" style={{ marginTop: "1rem" }}>
              <label>Auth Mode</label>
              <Dropdown value={gatewayAuthMode} onChange={(v) => setField("gatewayAuthMode", v)} options={[
                { value: "token", label: "Token (Secure)", description: "Requires authentication token" },
                { value: "none", label: "None (Insecure)", description: "No authentication required" }
              ]} />
            </div>
            <div className="form-group" style={{ marginTop: "1rem" }}>
              <label>Tailscale</label>
              <Dropdown value={tailscaleMode} onChange={(v) => setField("tailscaleMode", v)} options={[
                { value: "off", label: "Disabled", description: "Standard networking" },
                { value: "on", label: "Enabled", description: "Expose securely via Tailscale" }
              ]} />
            </div>
          </div>
        )}
      </div>

      {/* Runtime Environment */}
      <div className="accordion-section" style={{ marginBottom: "1rem" }}>
        <button
          className="accordion-header"
          onClick={() => setField("extraSettingsOpen", { ...extraSettingsOpen, runtime: !extraSettingsOpen.runtime })}
          style={{
            width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "1rem", background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: extraSettingsOpen.runtime ? "12px 12px 0 0" : "12px",
            cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
          }}
        >
          <span>Runtime Environment</span>
          <span className={`accordion-chevron ${extraSettingsOpen.runtime ? "rotated" : ""}`}>▼</span>
        </button>
        {extraSettingsOpen.runtime && (
          <div style={{ padding: "1rem", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 12px 12px", background: "var(--bg-card)" }}>
            <div className="form-group">
              <label>Node Package Manager</label>
              <Dropdown value={nodeManager} onChange={(v) => setField("nodeManager", v)} options={[
                { value: "npm", label: "npm" },
                { value: "pnpm", label: "pnpm" },
                { value: "bun", label: "bun" }
              ]} />
            </div>
          </div>
        )}
      </div>

      {/* Security (Sandbox) */}
      <div className="accordion-section" style={{ marginBottom: "1rem" }}>
        <button
          className="accordion-header"
          onClick={() => setField("extraSettingsOpen", { ...extraSettingsOpen, security: !extraSettingsOpen.security })}
          style={{
            width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "1rem", background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: extraSettingsOpen.security ? "12px 12px 0 0" : "12px",
            cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
          }}
        >
          <span>Security (Sandbox)</span>
          <span className={`accordion-chevron ${extraSettingsOpen.security ? "rotated" : ""}`}>▼</span>
        </button>
        {extraSettingsOpen.security && (
          <div style={{ padding: "1rem", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 12px 12px", background: "var(--bg-card)" }}>
            <div className="form-group">
              <label>Sandbox Mode</label>
              <Dropdown value={sandboxMode} onChange={(v) => setField("sandboxMode", v)} options={[
                { value: "full", label: "Full Sandbox", description: "REQUIRES DOCKER! Select only if Docker is installed." },
                { value: "partial", label: "Partial Sandbox", description: "Standard isolation." },
                { value: "none", label: "No Sandbox", description: "Unrestricted access." }
              ]} />
            </div>
          </div>
        )}
      </div>

      {/* Session Management */}
      <div className="accordion-section" style={{ marginBottom: "1rem" }}>
        <button
          className="accordion-header"
          onClick={() => setField("extraSettingsOpen", { ...extraSettingsOpen, session: !extraSettingsOpen.session })}
          style={{
            width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "1rem", background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: extraSettingsOpen.session ? "12px 12px 0 0" : "12px",
            cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
          }}
        >
          <span>Session Management</span>
          <span className={`accordion-chevron ${extraSettingsOpen.session ? "rotated" : ""}`}>▼</span>
        </button>
        {extraSettingsOpen.session && (
          <div style={{ padding: "1rem", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 12px 12px", background: "var(--bg-card)" }}>
            <div className="mode-card-container" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {[
                { mode: "1h", label: "Hourly", desc: "Reset every hour" },
                { mode: "4h", label: "4 Hours", desc: "Reset every 4 hours" },
                { mode: "24h", label: "Daily", desc: "Reset once per day" },
                { mode: "idle", label: "Idle Timeout", desc: "Reset after inactivity" },
                { mode: "never", label: "Never", desc: "Manual reset only" }
              ].map(item => (
                <div
                  key={item.mode}
                  className={`mode-card ${heartbeatMode === item.mode ? "active" : ""}`}
                  onClick={() => setField("heartbeatMode", item.mode)}
                >
                  <h3>{item.label}</h3>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>
            {heartbeatMode === "idle" && (
              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Idle Timeout (minutes)</label>
                <input type="number" value={idleTimeoutMs / 60000} onChange={e => setField("idleTimeoutMs", Number(e.target.value) * 60000)} min="1" max="1440" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="button-group">
        <button className="primary" data-testid="btn-next" onClick={() => setField("step", 16)}>Next</button>
        <button className="secondary" onClick={() => setField("step", enableMultiAgent ? 15.5 : 15)}>Back</button>
      </div>
    </div>
  );
}
