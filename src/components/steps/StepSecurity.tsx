import { useWizard } from "../../context/WizardContext";

export default function StepSecurity() {
  const { state, dispatch } = useWizard();
  const platformName = state.platform === "hermes" ? "Hermes Agent" : "OpenClaw";

  return (
    <div className="step-view" data-testid="step-security">
      <h2>Security Baseline</h2>
      <p className="step-description">Please read this carefully before proceeding.</p>
      <div className="security-alert">
        <p>{platformName} is a powerful agent system that can execute code and manage files.</p>
        <p>A malicious prompt could potentially trick the agent into performing unsafe actions. We recommend running it in a sandboxed environment if possible.</p>
        <p>Keep your API keys secure and never share your gateway token.</p>
      </div>
      <p style={{ fontWeight: 600 }}>Do you understand the risks and wish to continue?</p>
      <div className="button-group">
        <button className="primary" onClick={() => dispatch({ type: "SET_FIELD", field: "step", value: 5 })} data-testid="btn-i-understand">I Understand</button>
        <button className="secondary" onClick={() => dispatch({ type: "SET_FIELD", field: "step", value: 2 })}>Back</button>
      </div>
    </div>
  );
}
