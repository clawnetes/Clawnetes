import { useWizard } from "../../../context/WizardContext";

export default function StepHermesWelcome() {
  const { dispatch } = useWizard();

  const setStep = (value: number) => dispatch({ type: "SET_FIELD", field: "step", value });

  return (
    <div className="step-view" data-testid="step-hermes-welcome">
      <h2>Hermes Setup</h2>
      <p className="step-description">
        Hermes uses a separate setup flow in Clawnetes. Local macOS, WSL2-backed Windows, and remote Linux over SSH are the supported v1 targets.
      </p>
      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" onClick={() => setStep(19)}>Continue</button>
        <button className="secondary" onClick={() => setStep(6.5)}>Back</button>
      </div>
    </div>
  );
}
