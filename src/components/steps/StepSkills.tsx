import { invoke } from "@tauri-apps/api/tauri";
import { useWizard } from "../../context/WizardContext";
import { AVAILABLE_SKILLS } from "../../presets/availableSkills";
import { SKILL_ICONS } from "../../presets/modelsByProvider";

interface StepSkillsProps {
  handleInstall: () => void;
}

export default function StepSkills({ handleInstall }: StepSkillsProps) {
  const { state, dispatch } = useWizard();
  const {
    agentName, selectedSkills, serviceKeys, mode,
    showCustomSkillForm, customSkillName, customSkillContent,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  const toggleSkill = (id: string) => {
    setField("selectedSkills",
      selectedSkills.includes(id) ? selectedSkills.filter(s => s !== id) : [...selectedSkills, id]
    );
  };

  const availableSkills = AVAILABLE_SKILLS;

  return (
    <div className="step-view" data-testid="step-skills">
      <h2>Give {agentName ? `${agentName}` : "your agent"} some skills</h2>
      <p className="step-description">Enable capabilities and configure required keys.</p>
      <div className="skills-container" style={{ maxHeight: "450px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "12px", padding: "0.5rem" }}>
        <div className="skills-grid">
          {availableSkills.map(skill => (
            <div
              key={skill.id}
              className={`skill-card ${selectedSkills.includes(skill.id) ? "active" : ""}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).tagName === "INPUT") return;
                toggleSkill(skill.id);
              }}
              style={{
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                minHeight: "100px"
              }}
            >
              <div className="skill-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  {SKILL_ICONS[skill.id] && (
                    <img
                      src={SKILL_ICONS[skill.id]}
                      alt=""
                      style={{
                        width: "20px", height: "20px", objectFit: "contain",
                        borderRadius: "4px", backgroundColor: "white", padding: "2px", marginRight: "8px"
                      }}
                    />
                  )}
                  <div className="skill-name" style={{ fontWeight: 700 }}>{skill.name}</div>
                </div>
                <div className={`radio-circle ${selectedSkills.includes(skill.id) ? "checked" : ""}`} style={{
                  width: "18px", height: "18px", borderRadius: "50%",
                  border: `2px solid ${selectedSkills.includes(skill.id) ? "var(--primary)" : "var(--text-muted)"}`,
                  backgroundColor: selectedSkills.includes(skill.id) ? "var(--primary)" : "transparent",
                  flexShrink: 0
                }} />
              </div>
              <div className="skill-desc" style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.4" }}>{skill.desc}</div>

              {skill.requiresAuth && selectedSkills.includes(skill.id) && (
                <div className="skill-auth" style={{ marginTop: "auto", paddingTop: "0.5rem" }}>
                  {skill.authMode === "oauth" ? (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: "100%", fontSize: "0.8rem", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                    >
                      Browser authentication will run at the end of setup.
                    </div>
                  ) : (
                    <input
                      type="password"
                      placeholder={skill.authPlaceholder || "API Key"}
                      value={serviceKeys[skill.id] || ""}
                      onChange={(e) => setField("serviceKeys", { ...serviceKeys, [skill.id]: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: "100%", fontSize: "0.8rem", padding: "0.5rem", borderRadius: "8px" }}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <button className="secondary" onClick={() => setField("showCustomSkillForm", !showCustomSkillForm)}>
          {showCustomSkillForm ? "Hide" : "+ Add"} Custom Skill
        </button>
      </div>

      {showCustomSkillForm && (
        <div className="custom-skill-form" style={{ marginTop: "1.5rem" }}>
          <div className="form-group">
            <label>Skill Name</label>
            <input
              placeholder="my-custom-skill"
              value={customSkillName}
              onChange={e => setField("customSkillName", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Skill Content (YAML + Markdown)</label>
            <textarea
              className="markdown-editor"
              rows={8}
              value={customSkillContent}
              onChange={e => setField("customSkillContent", e.target.value)}
              placeholder={`---\nname: My Custom Skill\ndescription: A useful skill\n---\n\n# Instructions\nAdd skill documentation here...`}
            />
          </div>
          <button
            className="primary"
            disabled={!customSkillName || !customSkillContent}
            onClick={async () => {
              try {
                await invoke("create_custom_skill", { name: customSkillName, content: customSkillContent });
                setField("selectedSkills", [...selectedSkills, customSkillName]);
                setField("customSkillName", "");
                setField("customSkillContent", "");
                setField("showCustomSkillForm", false);
              } catch (e) {
                alert("Failed to create skill: " + e);
              }
            }}
          >
            Save Custom Skill
          </button>
        </div>
      )}

      <div className="button-group">
        <button className="primary" data-testid="btn-continue" onClick={() => {
          if (mode === "advanced") {
            setField("step", 11.1);
          } else {
            handleInstall();
          }
        }}>Continue</button>
        <button className="secondary" onClick={() => setField("step", 13)}>Back</button>
      </div>
    </div>
  );
}
