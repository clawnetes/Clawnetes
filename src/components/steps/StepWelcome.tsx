import { useWizard } from "../../context/WizardContext";

export default function StepWelcome() {
  const { dispatch } = useWizard();

  return (
    <div className="step-view welcome-view" data-testid="step-welcome">
      <div className="welcome-logo">🦞</div>
      <h1 className="welcome-title">Welcome to Clawnetes</h1>
      <p className="welcome-text">
        The fastest way to deploy your AI agent. Get started in minutes.
      </p>
      <div className="button-group" style={{ justifyContent: "center" }}>
        <button
          className="primary"
          style={{ minWidth: "200px", padding: "1rem 2rem", fontSize: "1.1rem" }}
          onClick={() => dispatch({ type: "SET_FIELD", field: "step", value: 1 })}
          data-testid="btn-start-setup"
        >
          Start Setup
        </button>
      </div>
    </div>
  );
}
