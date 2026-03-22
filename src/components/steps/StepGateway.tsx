import { useWizard } from "../../context/WizardContext";
import Dropdown from "../Dropdown";

export default function StepGateway() {
  const { state, dispatch } = useWizard();
  const { gatewayPort, gatewayBind, gatewayAuthMode, tailscaleMode } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view">
      <h2>Gateway Settings</h2>
      <p className="step-description">Configure the network bridge for your agent.</p>
      <div className="form-group">
        <label>Port</label>
        <input type="number" value={gatewayPort} onChange={(e) => setField("gatewayPort", parseInt(e.target.value))} autoComplete="off" />
      </div>
      <div className="form-group">
        <label>Bind Address</label>
        <Dropdown
          value={gatewayBind}
          onChange={(v) => setField("gatewayBind", v)}
          options={[
            { value: "loopback", label: "Loopback (127.0.0.1)", description: "Only accessible from this machine" },
            { value: "all", label: "All Interfaces (0.0.0.0)", description: "Accessible from local network" }
          ]}
        />
      </div>
      <div className="form-group" style={{ marginTop: "1.5rem" }}>
        <label>Auth Mode</label>
        <Dropdown
          value={gatewayAuthMode}
          onChange={(v) => setField("gatewayAuthMode", v)}
          options={[
            { value: "token", label: "Token (Secure)", description: "Requires authentication token" },
            { value: "none", label: "None (Insecure)", description: "No authentication required" }
          ]}
        />
      </div>
      <div className="form-group" style={{ marginTop: "1.5rem" }}>
        <label>Tailscale</label>
        <Dropdown
          value={tailscaleMode}
          onChange={(v) => setField("tailscaleMode", v)}
          options={[
            { value: "off", label: "Disabled", description: "Standard networking" },
            { value: "on", label: "Enabled", description: "Expose securely via Tailscale" }
          ]}
        />
      </div>
      <div className="button-group">
        <button className="primary" onClick={() => {
          setField("step", 10);
        }}>Continue</button>
        <button className="secondary" onClick={() => setField("step", 6)}>Back</button>
      </div>
    </div>
  );
}
