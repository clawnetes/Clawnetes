import { useWizard } from "../../context/WizardContext";
import { PERSONA_TEMPLATES } from "../../presets/personaTemplates";
import { updateIdentityField, updateSoulMission } from "../../utils/markdownHelpers";
import Dropdown from "../Dropdown";
import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";

interface StepPersonalityProps {
  handleSaveWorkspace: () => void;
}

export default function StepPersonality({ handleSaveWorkspace }: StepPersonalityProps) {
  const { state, dispatch } = useWizard();
  const {
    agentName, agentEmoji, userName, agentType, selectedPersona,
    activeWorkspaceTab, identityMd, userMd, soulMd, toolsMd, agentsMd,
    workspaceModified, savingWorkspace,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  const isPresetAgent = agentType !== "custom";

  return (
    <div className="step-view" data-testid="step-personality">
      <h2>Customize {agentName ? `${agentName}'s` : "your agent's"} personality</h2>
      <p className="step-description">Edit your agent's identity, personality, and mission.</p>

      <div className="form-group" style={{ marginBottom: "1.5rem" }}>
        <label>Persona Template</label>
        <Dropdown
          value={selectedPersona}
          onChange={(val) => {
            setField("selectedPersona", val);
            if (val !== "custom" && PERSONA_TEMPLATES[val]) {
              const t = PERSONA_TEMPLATES[val];
              let newIdentity = t.identity;
              let newSoul = t.soul;

              if (agentName) {
                newIdentity = updateIdentityField(newIdentity, "Name", agentName);
                newSoul = updateSoulMission(newSoul, agentName);
              }

              setField("identityMd", newIdentity);
              setField("soulMd", newSoul);
            }
          }}
          options={[
            { value: "custom", label: "Custom / Empty" },
            ...Object.keys(PERSONA_TEMPLATES).filter(k => k !== "custom").sort().map(k => ({
              value: k,
              label: PERSONA_TEMPLATES[k].name
            }))
          ]}
        />
      </div>

      <div className="workspace-tabs">
        {[
          { id: "identity", label: "IDENTITY.md" },
          { id: "user", label: "USER.md" },
          { id: "soul", label: "SOUL.md" },
          { id: "tools", label: "TOOLS.md" },
          { id: "agents", label: "AGENTS.md" }
        ].map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeWorkspaceTab === tab.id ? "active" : ""}`}
            onClick={() => setField("activeWorkspaceTab", tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="workspace-editor">
        {activeWorkspaceTab === "identity" && (
          <textarea {...TEXT_ENTRY_PROPS} className="markdown-editor" rows={12} value={identityMd}
            onChange={e => setField("identityMd", e.target.value)}
            placeholder={`# IDENTITY.md - Who Am I?\n- **Name:** ${agentName}\n- **Emoji:** ${agentEmoji}\n\nAdd more details about your agent's identity...`}
          />
        )}
        {activeWorkspaceTab === "user" && (
          <textarea {...TEXT_ENTRY_PROPS} className="markdown-editor" rows={12} value={userMd}
            onChange={e => setField("userMd", e.target.value)}
            placeholder={`# USER.md - About Your Human\n- **Name:** ${userName}\n\nAdd more details about yourself...`}
          />
        )}
        {activeWorkspaceTab === "soul" && (
          <textarea {...TEXT_ENTRY_PROPS} className="markdown-editor" rows={12} value={soulMd}
            onChange={e => setField("soulMd", e.target.value)}
            placeholder={`# SOUL.md\n## Mission\nServe ${userName}.\n\nAdd your agent's mission statement and guiding principles...`}
          />
        )}
        {activeWorkspaceTab === "tools" && (
          <textarea {...TEXT_ENTRY_PROPS} className="markdown-editor" rows={12} value={toolsMd}
            onChange={e => setField("toolsMd", e.target.value)}
            placeholder={`# TOOLS.md\nDefine tool usage policies and instructions for your agent...`}
          />
        )}
        {activeWorkspaceTab === "agents" && (
          <textarea {...TEXT_ENTRY_PROPS} className="markdown-editor" rows={12} value={agentsMd}
            onChange={e => setField("agentsMd", e.target.value)}
            placeholder={`# AGENTS.md\nDefine agent routing and sub-agent configuration...`}
          />
        )}
      </div>

      <p className="input-hint" style={{ marginTop: "1rem" }}>
        Leave blank to use auto-generated defaults. Changes can be edited later in the workspace folder.
      </p>

      <div className="button-group" style={{ gap: "0.5rem" }}>
        <button
          className="secondary"
          disabled={!workspaceModified || savingWorkspace}
          onClick={() => handleSaveWorkspace()}
          style={{ flex: "0 0 auto", minWidth: "150px" }}
        >
          {savingWorkspace ? "Saving..." : "💾 Save Changes"}
        </button>
        <button className="primary" data-testid="btn-next" onClick={() => setField("step", isPresetAgent ? 15 : 13)} style={{ flex: 1 }}>
          Next
        </button>
        <button className="secondary" onClick={() => setField("step", 9)} style={{ flex: "0 0 auto" }}>Back</button>
      </div>
    </div>
  );
}
