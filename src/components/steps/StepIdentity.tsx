import { useWizard } from "../../context/WizardContext";
import { updateIdentityField } from "../../utils/markdownHelpers";
import { updateSoulMission } from "../../utils/markdownHelpers";
import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";

export default function StepIdentity() {
  const { state, dispatch } = useWizard();
  const { userName, userMd, soulMd } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view" data-testid="step-identity">
      <h2>Your Identity</h2>
      <p className="step-description">What should the agent call you?</p>
      <div className="form-group">
        <label>Your Name</label>
        <input
          {...TEXT_ENTRY_PROPS}
          autoFocus
          placeholder="e.g. David"
          data-testid="input-user-name"
          value={userName}
          onChange={(e) => {
            const val = e.target.value;
            setField("userName", val);
            if (userMd) {
              setField("userMd", updateIdentityField(userMd, "Name", val));
            }
            if (soulMd) {
              setField("soulMd", updateSoulMission(soulMd, val));
            }
          }}
        />
      </div>
      <div className="button-group">
        <button className="primary" disabled={!userName} onClick={() => setField("step", 6)} data-testid="btn-next">Next</button>
        <button className="secondary" onClick={() => setField("step", 3)}>Back</button>
      </div>
    </div>
  );
}
