import { useWizard } from "../../context/WizardContext";

export default function StepSession() {
  const { state, dispatch } = useWizard();
  const { heartbeatMode, idleTimeoutMs } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view">
      <h2>Session Management</h2>
      <p className="step-description">Control when the agent resets context to save costs.</p>

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
        <div className="form-group" style={{ marginTop: "1.5rem" }}>
          <label>Idle Timeout (minutes)</label>
          <input
            type="number"
            value={idleTimeoutMs / 60000}
            onChange={e => setField("idleTimeoutMs", Number(e.target.value) * 60000)}
            min="1"
            max="1440"
            autoComplete="off"
          />
          <p className="input-hint">Agent will reset context after this many minutes of inactivity.</p>
        </div>
      )}

      <div className="button-group">
        <button className="primary" onClick={() => setField("step", 15)}>Continue</button>
        <button className="secondary" onClick={() => setField("step", 13)}>Back</button>
      </div>
    </div>
  );
}
