import { useWizard } from "../../context/WizardContext";
import Dropdown from "../Dropdown";
import ToolPolicyEditor from "../ToolPolicyEditor";
import type { ToolPolicy } from "../../types";

export default function StepSecurityConfig() {
  const { state, dispatch } = useWizard();
  const { sandboxMode, toolPolicy } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view">
      <h2>Security Configuration</h2>
      <p className="step-description">Configure security policies for your agent.</p>

      <div className="form-group">
        <label>Sandbox Mode</label>
        <Dropdown
          value={sandboxMode}
          onChange={(v) => setField("sandboxMode", v)}
          options={[
            { value: "full", label: "Full Sandbox", description: "REQUIRES DOCKER! Select only if Docker is installed, otherwise this will break." },
            { value: "partial", label: "Partial Sandbox", description: "Standard isolation." },
            { value: "none", label: "No Sandbox", description: "Unrestricted access." }
          ]}
        />
      </div>

      <div className="form-group" style={{ marginTop: "1.5rem" }}>
        <ToolPolicyEditor
          policy={toolPolicy}
          onChange={(v: ToolPolicy) => setField("toolPolicy", v)}
          description="Use a profile as the base, then refine individual tools."
        />
      </div>

      <div className="button-group">
        <button className="primary" onClick={() => setField("step", 13)}>Continue</button>
        <button className="secondary" onClick={() => setField("step", 11.5)}>Back</button>
      </div>
    </div>
  );
}
