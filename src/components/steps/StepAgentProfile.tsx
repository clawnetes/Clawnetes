import { useWizard } from "../../context/WizardContext";
import { EMOJI_OPTIONS } from "../../presets/modelsByProvider";
import { updateIdentityField } from "../../utils/markdownHelpers";
import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";

export default function StepAgentProfile() {
  const { state, dispatch } = useWizard();
  const { agentName, agentEmoji, identityMd, skipBasicConfig } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  return (
    <div className="step-view" data-testid="step-agent-profile">
      <h2>Agent Profile</h2>
      <p className="step-description">Give your agent a name and a personality.</p>
      <div className="form-group">
        <label>Agent Name</label>
        <input {...TEXT_ENTRY_PROPS} autoFocus placeholder="e.g. Jeeves" data-testid="input-agent-name" value={agentName} onChange={(e) => {
          const val = e.target.value;
          setField("agentName", val);
          if (identityMd) {
            setField("identityMd", updateIdentityField(identityMd, "Name", val));
          }
        }} />
      </div>
      <div className="form-group">
        <label>Agent Emoji</label>
        <div className="emoji-grid" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {EMOJI_OPTIONS.map(e => (
            <button
              key={e}
              className={`emoji-btn`}
              onClick={() => {
                setField("agentEmoji", e);
                if (identityMd) {
                  setField("identityMd", updateIdentityField(identityMd, "Emoji", e));
                }
              }}
              style={{
                fontSize: "1.25rem",
                padding: "0.4rem",
                borderRadius: "8px",
                border: agentEmoji === e ? "2px solid var(--primary)" : "1px solid var(--border)",
                background: agentEmoji === e ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
                cursor: "pointer",
                minWidth: "40px"
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div className="button-group">
        <button className="primary" disabled={!agentName} onClick={() => setField("step", 6.5)} data-testid="btn-next">Next</button>
        <button className="secondary" onClick={() => setField("step", skipBasicConfig ? 0 : 5)}>Back</button>
      </div>
    </div>
  );
}
