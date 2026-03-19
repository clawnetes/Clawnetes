import { useWizard } from "../../context/WizardContext";
import Dropdown from "../Dropdown";

export default function StepRuntime() {
  const { state, dispatch } = useWizard();
  const { nodeManager, skipBasicConfig } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view">
      <h2>Runtime Environment</h2>
      <p className="step-description">Configure how the agent executes tools and skills.</p>
      <div className="form-group">
        <label>Node Package Manager</label>
        <Dropdown
          value={nodeManager}
          onChange={(v) => setField("nodeManager", v)}
          options={[
            { value: "npm", label: "npm" },
            { value: "pnpm", label: "pnpm" },
            { value: "bun", label: "bun" }
          ]}
        />
      </div>
      <div className="button-group">
        <button className="primary" onClick={() => setField("step", 10.5)}>Next</button>
        <button className="secondary" onClick={() => {
          if (skipBasicConfig) {
            setField("step", 7);
          } else {
            setField("step", 9);
          }
        }}>Back</button>
      </div>
    </div>
  );
}
