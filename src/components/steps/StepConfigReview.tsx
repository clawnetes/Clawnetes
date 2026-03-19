import { useWizard } from "../../context/WizardContext";
import { AGENT_TYPE_PRESETS } from "../../presets/agentPresets";
import { AVAILABLE_SKILLS } from "../../presets/availableSkills";
import { SKILL_ICONS } from "../../presets/modelsByProvider";
import { isOAuthMethod, LOCAL_PROVIDERS } from "../../utils/providerAuth";
import type { ProviderAuthConfig } from "../../types";
import type { ReactNode } from "react";

interface StepConfigReviewProps {
  renderProviderAuthEditor: (provider: string) => ReactNode;
  getProviderAuth: (provider: string) => ProviderAuthConfig;
}

export default function StepConfigReview({ renderProviderAuthEditor, getProviderAuth }: StepConfigReviewProps) {
  const { state, dispatch } = useWizard();
  const { agentType, provider, selectedSkills, serviceKeys } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  const presetData = AGENT_TYPE_PRESETS[agentType];
  const availableSkills = AVAILABLE_SKILLS;

  return (
    <div className="step-view">
      <h2>Configuration Review</h2>
      <p className="step-description">Your {presetData?.name || "agent"} is pre-configured with these settings. Enter your API key to continue.</p>

      {presetData && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <div className="status-card" style={{ padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Model</div>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{presetData.model.split("/").pop()}</div>
          </div>
          <div className="status-card" style={{ padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Fallback</div>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{presetData.fallbackModels[0]?.split("/").pop() || "None"}</div>
          </div>
          <div className="status-card" style={{ padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Skills</div>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{presetData.skills.length} configured</div>
          </div>
          <div className="status-card" style={{ padding: "1rem", borderRadius: "8px", backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Heartbeat</div>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{presetData.heartbeatMode === "never" ? "Disabled" : `Every ${presetData.heartbeatMode}`}</div>
          </div>
        </div>
      )}

      <div className="form-group">
        <label>Skills Included</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
          {selectedSkills.map(s => (
            <span key={s} style={{
              padding: "0.25rem 0.75rem", borderRadius: "20px",
              backgroundColor: "rgba(255, 59, 48, 0.08)", border: "1px solid var(--primary)",
              fontSize: "0.8rem", fontWeight: 500
            }}>
              {SKILL_ICONS[s] && <img src={SKILL_ICONS[s]} alt="" style={{ width: "14px", height: "14px", marginRight: "4px", verticalAlign: "middle", borderRadius: "3px" }} />}
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="form-group" style={{ marginTop: "1.5rem" }}>
        {renderProviderAuthEditor(provider)}
      </div>

      {selectedSkills.filter(s => {
        const skill = availableSkills.find(sk => sk.id === s);
        return skill?.requiresAuth && skill.authMode !== "oauth";
      }).length > 0 && (
        <div className="form-group" style={{ marginTop: "1rem" }}>
          <label>Skill API Keys (Optional)</label>
          {selectedSkills.filter(s => {
            const skill = availableSkills.find(sk => sk.id === s);
            return skill?.requiresAuth && skill.authMode !== "oauth";
          }).map(s => {
            const skill = availableSkills.find(sk => sk.id === s)!;
            return (
              <div key={s} style={{ marginTop: "0.5rem" }}>
                <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{skill.name}</label>
                <input
                  type="password"
                  value={serviceKeys[s] || ""}
                  onChange={(e) => setField("serviceKeys", { ...serviceKeys, [s]: e.target.value })}
                  placeholder={skill.authPlaceholder || "API Key"}
                  autoComplete="off"
                />
              </div>
            );
          })}
        </div>
      )}

      {selectedSkills.filter(s => {
        const skill = availableSkills.find(sk => sk.id === s);
        return skill?.authMode === "oauth";
      }).length > 0 && (
        <div className="form-group" style={{ marginTop: "1rem" }}>
          <label>Skill OAuth (Deferred)</label>
          {selectedSkills.filter(s => {
            const skill = availableSkills.find(sk => sk.id === s);
            return skill?.authMode === "oauth";
          }).map(s => {
            const skill = availableSkills.find(sk => sk.id === s)!;
            return (
              <div key={s} style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                {skill.name}: an OpenClaw terminal auth step will run at the end of setup.
              </div>
            );
          })}
        </div>
      )}

      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" disabled={!LOCAL_PROVIDERS.has(provider) && !isOAuthMethod(getProviderAuth(provider).auth_method) && !getProviderAuth(provider).token} onClick={() => setField("step", 9)}>Next</button>
        <button className="secondary" onClick={() => setField("step", 6.5)}>Back</button>
      </div>
    </div>
  );
}
