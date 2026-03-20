import { useWizard } from "../../context/WizardContext";
import ToolPolicyEditor from "../ToolPolicyEditor";
import type { ToolPolicy } from "../../types";

export default function StepToolAccess() {
  const { state, dispatch } = useWizard();
  const { toolPolicy } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view" data-testid="step-allowed-tools">
      <h2>Tool Access</h2>
      <p className="step-description">Configure the base tool profile and individual tool access.</p>

      <ToolPolicyEditor
        policy={toolPolicy}
        onChange={(v: ToolPolicy) => setField("toolPolicy", v)}
        description="Profiles set the default OpenClaw allowlist. Individual toggles override that baseline."
      />

      <div className="button-group">
        <button className="primary" data-testid="btn-next" onClick={() => setField("step", 15)}>Next</button>
        <button className="secondary" onClick={() => setField("step", 11)}>Back</button>
      </div>
    </div>
  );
}
