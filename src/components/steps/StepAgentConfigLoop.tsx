import { useWizard } from "../../context/WizardContext";
import { MODELS_BY_PROVIDER, PROVIDER_LOGOS, EMOJI_OPTIONS, SKILL_ICONS } from "../../presets/modelsByProvider";
import { PERSONA_TEMPLATES } from "../../presets/personaTemplates";
import { AVAILABLE_SKILLS } from "../../presets/availableSkills";
import { updateIdentityField, updateSoulMission } from "../../utils/markdownHelpers";
import { buildReferencedProviders, getBaseProviderFromModel } from "../../utils/providerAuth";
import { createInheritedToolPolicy } from "../../utils/toolSelection";
import ToolPolicyEditor from "../ToolPolicyEditor";
import Dropdown from "../Dropdown";
import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";
import type { AgentConfigData } from "../../types";
import type { ReactNode } from "react";

interface StepAgentConfigLoopProps {
  renderProviderAuthEditor: (provider: string) => ReactNode;
  getProviderDefaultModel: (provider: string) => string;
  getProviderModelOptions: (provider: string) => { value: string; label: string }[];
}

export default function StepAgentConfigLoop({ renderProviderAuthEditor, getProviderDefaultModel, getProviderModelOptions }: StepAgentConfigLoopProps) {
  const { state, dispatch } = useWizard();
  const {
    enableMultiAgent, agentConfigs, currentAgentConfigIdx, activeWorkspaceTab,
    model, agentEmoji, userName, toolPolicy, loading,
    lmstudioBaseUrl, localBaseUrl,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  const availableSkills = AVAILABLE_SKILLS;

  // Guard: redirect if no agents to configure
  if (!enableMultiAgent || currentAgentConfigIdx >= agentConfigs.length) {
    setField("step", 15.7);
    return null;
  }

  const currentAgent = agentConfigs[currentAgentConfigIdx];
  const currentAgentProvider = getBaseProviderFromModel(currentAgent.model);
  const currentAgentReferencedProviders = buildReferencedProviders({
    primaryModel: currentAgent.model,
    fallbackModels: currentAgent.fallbackModels || [],
  });

  const updateAgentConfigs = (updater: (configs: AgentConfigData[]) => void) => {
    const updated = [...agentConfigs];
    updater(updated);
    setField("agentConfigs", updated);
  };

  return (
    <div className="step-view">
      <h2>Configure Agent {currentAgentConfigIdx + 1} of {agentConfigs.length}</h2>
      <p className="step-description">Set up the model, skills, and personality for {currentAgent.name || "this agent"}.</p>

      <div className="form-group">
        <label>Agent Name</label>
        <input
          {...TEXT_ENTRY_PROPS}
          value={currentAgent.name}
          onChange={(e) => {
            const val = e.target.value;
            updateAgentConfigs((updated) => {
              updated[currentAgentConfigIdx].name = val;
              if (updated[currentAgentConfigIdx].identityMd) {
                updated[currentAgentConfigIdx].identityMd = updateIdentityField(updated[currentAgentConfigIdx].identityMd, "Name", val);
              }
            });
          }}
          placeholder="e.g., CodeBot"
        />
      </div>

      <div className="form-group">
        <label>Agent Emoji</label>
        <div className="emoji-grid" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {EMOJI_OPTIONS.map(e => (
            <button
              key={e}
              className={`emoji-btn`}
              onClick={() => {
                updateAgentConfigs((updated) => {
                  updated[currentAgentConfigIdx].emoji = e;
                  if (updated[currentAgentConfigIdx].identityMd) {
                    updated[currentAgentConfigIdx].identityMd = updateIdentityField(updated[currentAgentConfigIdx].identityMd, "Emoji", e);
                  }
                });
              }}
              style={{
                fontSize: "1.25rem",
                padding: "0.4rem",
                borderRadius: "8px",
                border: currentAgent.emoji === e ? "2px solid var(--primary)" : "1px solid var(--border)",
                background: currentAgent.emoji === e ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
                cursor: "pointer",
                minWidth: "40px"
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: "1.5rem" }}>
        <label>Persona Template</label>
        <Dropdown
          value={currentAgent.persona || "custom"}
          onChange={(val) => {
            updateAgentConfigs((updated) => {
              updated[currentAgentConfigIdx].persona = val;

              if (val !== "custom" && PERSONA_TEMPLATES[val]) {
                const t = PERSONA_TEMPLATES[val];
                let newIdentity = t.identity;
                let newSoul = t.soul;

                if (updated[currentAgentConfigIdx].name) {
                  newIdentity = updateIdentityField(newIdentity, "Name", updated[currentAgentConfigIdx].name);
                  newSoul = updateSoulMission(newSoul, updated[currentAgentConfigIdx].name);
                }

                updated[currentAgentConfigIdx].identityMd = newIdentity;
                updated[currentAgentConfigIdx].soulMd = newSoul;
              }
            });
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

      <h3 style={{ marginTop: "2rem" }}>Agent Workspace</h3>
      <div className="workspace-tabs">
        {[
          { id: "identity", label: "IDENTITY.md" },
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

      <div className="workspace-editor" style={{ marginBottom: "2rem" }}>
        {activeWorkspaceTab === "identity" && (
          <textarea
            {...TEXT_ENTRY_PROPS}
            className="markdown-editor"
            rows={8}
            value={currentAgent.identityMd}
            onChange={e => {
              updateAgentConfigs((updated) => {
                updated[currentAgentConfigIdx].identityMd = e.target.value;
              });
            }}
            placeholder={`# IDENTITY.md\n- **Name:** ${currentAgent.name}\n- **Emoji:** ${currentAgent.emoji}`}
          />
        )}

        {activeWorkspaceTab === "soul" && (
          <textarea
            {...TEXT_ENTRY_PROPS}
            className="markdown-editor"
            rows={8}
            value={currentAgent.soulMd}
            onChange={e => {
              updateAgentConfigs((updated) => {
                updated[currentAgentConfigIdx].soulMd = e.target.value;
              });
            }}
            placeholder={`# SOUL.md\n## Mission\nServe ${userName}.`}
          />
        )}

        {activeWorkspaceTab === "tools" && (
          <textarea
            {...TEXT_ENTRY_PROPS}
            className="markdown-editor"
            rows={8}
            value={currentAgent.toolsMd}
            onChange={e => {
              updateAgentConfigs((updated) => {
                updated[currentAgentConfigIdx].toolsMd = e.target.value;
              });
            }}
            placeholder={`# TOOLS.md\nDefine tool usage policies for this agent...`}
          />
        )}

        {activeWorkspaceTab === "agents" && (
          <textarea
            {...TEXT_ENTRY_PROPS}
            className="markdown-editor"
            rows={8}
            value={currentAgent.agentsMd}
            onChange={e => {
              updateAgentConfigs((updated) => {
                updated[currentAgentConfigIdx].agentsMd = e.target.value;
              });
            }}
            placeholder={`# AGENTS.md\nDefine sub-agent routing for this agent...`}
          />
        )}
      </div>

      <div className="form-group" style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "1rem" }}>
        <label>Primary Model</label>

        <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Provider</label>
        <Dropdown
          value={currentAgentProvider}
          onChange={(newProv) => {
            updateAgentConfigs((updated) => {
              const defaultModel = getProviderDefaultModel(newProv);
              if (defaultModel) {
                updated[currentAgentConfigIdx].model = defaultModel;
              } else if (getProviderModelOptions(newProv).length > 0) {
                updated[currentAgentConfigIdx].model = getProviderModelOptions(newProv)[0].value;
              }
            });
          }}
          options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
            value: p,
            label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
            icon: PROVIDER_LOGOS[p]
          }))}
        />

        {currentAgentProvider && MODELS_BY_PROVIDER[currentAgentProvider] && (
          <div style={{ marginTop: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Model</label>
            <Dropdown
              value={currentAgent.model}
              onChange={(val) => {
                updateAgentConfigs((updated) => {
                  updated[currentAgentConfigIdx].model = val;
                });
              }}
              searchable={MODELS_BY_PROVIDER[currentAgentProvider].length > 10}
              options={getProviderModelOptions(currentAgentProvider)}
            />
          </div>
        )}

        {currentAgentProvider === "lmstudio" && (
          <div style={{ marginTop: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>LM Studio Base URL</label>
            <input {...TEXT_ENTRY_PROPS} type="text" placeholder="http://localhost:1234/v1" value={lmstudioBaseUrl} onChange={(e) => setField("lmstudioBaseUrl", e.target.value)} />
          </div>
        )}
        {currentAgentProvider === "local" && (
          <div style={{ marginTop: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Custom Base URL</label>
            <input {...TEXT_ENTRY_PROPS} type="text" placeholder="http://localhost:8080/v1" value={localBaseUrl} onChange={(e) => setField("localBaseUrl", e.target.value)} />
          </div>
        )}
      </div>

      <div className="form-group" style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label>Fallback Model (Optional)</label>
          {currentAgent.fallbackModels[0] && (
            <button className="secondary small" style={{ padding: "2px 8px", fontSize: "0.75rem", height: "auto" }} onClick={() => {
              updateAgentConfigs((updated) => {
                updated[currentAgentConfigIdx].fallbackModels = [];
              });
            }}>Clear</button>
          )}
        </div>

        {(() => {
          const currentFallbackModel = currentAgent.fallbackModels[0] || "";
          const currentFallbackProvider = getBaseProviderFromModel(currentFallbackModel);

          return (
            <>
              <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Provider</label>
              <Dropdown
                value={currentFallbackProvider || ""}
                onChange={(newProv) => {
                  if (!newProv) return;
                  updateAgentConfigs((updated) => {
                    const defaultModel = getProviderDefaultModel(newProv);
                    if (defaultModel) {
                      updated[currentAgentConfigIdx].fallbackModels = [defaultModel];
                    } else if (getProviderModelOptions(newProv).length > 0) {
                      updated[currentAgentConfigIdx].fallbackModels = [getProviderModelOptions(newProv)[0].value];
                    }
                  });
                }}
                options={Object.keys(MODELS_BY_PROVIDER).sort().map(p => ({
                  value: p,
                  label: p.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                  icon: PROVIDER_LOGOS[p]
                }))}
              />

              {currentFallbackProvider && MODELS_BY_PROVIDER[currentFallbackProvider] && (
                <div style={{ marginTop: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Model</label>
                  <Dropdown
                    value={currentFallbackModel}
                    onChange={(val) => {
                      updateAgentConfigs((updated) => {
                        updated[currentAgentConfigIdx].fallbackModels = [val];
                      });
                    }}
                    searchable={MODELS_BY_PROVIDER[currentFallbackProvider].length > 10}
                    options={getProviderModelOptions(currentFallbackProvider)}
                  />
                </div>
              )}

              {currentFallbackProvider === "lmstudio" && (
                <div style={{ marginTop: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>LM Studio Base URL</label>
                  <input {...TEXT_ENTRY_PROPS} type="text" placeholder="http://localhost:1234/v1" value={lmstudioBaseUrl} onChange={(e) => setField("lmstudioBaseUrl", e.target.value)} />
                </div>
              )}
              {currentFallbackProvider === "local" && (
                <div style={{ marginTop: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Custom Base URL</label>
                  <input {...TEXT_ENTRY_PROPS} type="text" placeholder="http://localhost:8080/v1" value={localBaseUrl} onChange={(e) => setField("localBaseUrl", e.target.value)} />
                </div>
              )}
            </>
          );
        })()}
      </div>

      {currentAgentReferencedProviders.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.5rem" }}>Provider Authentication</h3>
          <p className="step-description">Configure auth once for the remote providers used by this agent.</p>
          {currentAgentReferencedProviders.map(targetProvider => renderProviderAuthEditor(targetProvider))}
        </div>
      )}

      <div className="form-group">
        <label>Skills</label>
        <div className="skills-grid" style={{ marginTop: "0.5rem", maxHeight: "200px", overflowY: "auto" }}>
          {availableSkills.map(skill => (
            <div
              key={skill.id}
              className={`skill-card ${currentAgent.skills.includes(skill.id) ? "active" : ""}`}
              onClick={() => {
                updateAgentConfigs((updated) => {
                  const skills = updated[currentAgentConfigIdx].skills;
                  if (skills.includes(skill.id)) {
                    updated[currentAgentConfigIdx].skills = skills.filter(s => s !== skill.id);
                  } else {
                    updated[currentAgentConfigIdx].skills.push(skill.id);
                  }
                });
              }}
              style={{ padding: "0.75rem" }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                {SKILL_ICONS[skill.id] && (
                  <img
                    src={SKILL_ICONS[skill.id]}
                    alt=""
                    style={{
                      width: "16px",
                      height: "16px",
                      objectFit: "contain",
                      borderRadius: "3px",
                      backgroundColor: "white",
                      padding: "1px",
                      marginRight: "6px"
                    }}
                  />
                )}
                <div className="skill-name" style={{ fontSize: "0.85rem" }}>{skill.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tool Access */}
      <div className="form-group" style={{ marginTop: "1rem" }}>
        <ToolPolicyEditor
          policy={currentAgent.toolPolicy}
          inheritedPolicy={toolPolicy}
          onChange={(nextPolicy) => {
            updateAgentConfigs((updated) => {
              updated[currentAgentConfigIdx].toolPolicy = nextPolicy;
            });
          }}
          title="Tool Access"
          description="Per-agent overrides follow the same OpenClaw tool profile model."
          showElevatedToggle
          allowInherit
        />
      </div>

      {/* Cron Jobs */}
      <div className="form-group" style={{ marginTop: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label>Cron Jobs</label>
          <button className="secondary" style={{ padding: "2px 10px", fontSize: "0.75rem", height: "auto" }} onClick={() => {
            updateAgentConfigs((updated) => {
              updated[currentAgentConfigIdx].cronJobs = [...updated[currentAgentConfigIdx].cronJobs, { name: "", schedule: "", command: "" }];
            });
          }}>+ Add</button>
        </div>
        {currentAgent.cronJobs.map((cron, cronIdx) => (
          <div key={cronIdx} style={{ padding: "0.75rem", border: "1px solid var(--border)", borderRadius: "8px", marginTop: "0.5rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input
                {...TEXT_ENTRY_PROPS}
                placeholder="Job name"
                value={cron.name}
                onChange={e => {
                  updateAgentConfigs((updated) => {
                    updated[currentAgentConfigIdx].cronJobs[cronIdx].name = e.target.value;
                  });
                }}
                style={{ flex: 1 }}
              />
              <button className="secondary" style={{ padding: "2px 8px", fontSize: "0.75rem", height: "auto", color: "var(--error)" }} onClick={() => {
                updateAgentConfigs((updated) => {
                  updated[currentAgentConfigIdx].cronJobs = updated[currentAgentConfigIdx].cronJobs.filter((_, i) => i !== cronIdx);
                });
              }}>Remove</button>
            </div>
            <input
              {...TEXT_ENTRY_PROPS}
              placeholder="Schedule (e.g. 0 9 * * *)"
              value={cron.schedule}
              onChange={e => {
                updateAgentConfigs((updated) => {
                  updated[currentAgentConfigIdx].cronJobs[cronIdx].schedule = e.target.value;
                });
              }}
              style={{ marginBottom: "0.5rem" }}
            />
            <input
              {...TEXT_ENTRY_PROPS}
              placeholder="Command"
              value={cron.command}
              onChange={e => {
                updateAgentConfigs((updated) => {
                  updated[currentAgentConfigIdx].cronJobs[cronIdx].command = e.target.value;
                });
              }}
            />
          </div>
        ))}
      </div>

      {/* Add/Remove Agent buttons */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <button className="secondary" style={{ fontSize: "0.8rem" }} onClick={() => {
          const newAgent: AgentConfigData = {
            id: `agent-${agentConfigs.length + 1}`,
            name: `Agent ${agentConfigs.length + 1}`,
            model: model,
            fallbackModels: [],
            skills: [],
            vibe: "",
            emoji: agentEmoji,
            identityMd: "",
            userMd: "",
            soulMd: "",
            toolsMd: "",
            agentsMd: "",
            toolPolicy: createInheritedToolPolicy(),
            cronJobs: [],
          };
          setField("agentConfigs", [...agentConfigs, newAgent]);
          setField("numAgents", agentConfigs.length + 1);
        }}>+ Add Agent</button>
        {agentConfigs.length > 1 && (
          <button className="secondary" style={{ fontSize: "0.8rem", color: "var(--error)" }} onClick={() => {
            const updated = agentConfigs.filter((_, i) => i !== currentAgentConfigIdx);
            setField("agentConfigs", updated);
            setField("numAgents", updated.length);
            if (currentAgentConfigIdx >= updated.length) {
              setField("currentAgentConfigIdx", Math.max(0, updated.length - 1));
            }
          }}>Remove This Agent</button>
        )}
      </div>

      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" onClick={() => {
          if (currentAgentConfigIdx < agentConfigs.length - 1) {
            setField("currentAgentConfigIdx", currentAgentConfigIdx + 1);
            setField("activeWorkspaceTab", "identity");
          } else {
            // Auto-update main agent's AGENTS.md with routing config
            if (agentConfigs.length > 0) {
              const routingLines = agentConfigs.map(a => `- **${a.name}** (${a.id}): ${a.skills.join(", ") || "general"}`).join("\n");
              const agentsMdContent = `# AGENTS.md - Agent Routing\n\n## Available Sub-Agents\n${routingLines}\n`;
              setField("agentsMd", agentsMdContent);
            }
            setField("step", 15.7);
          }
        }} disabled={loading}>
          {currentAgentConfigIdx < agentConfigs.length - 1 ? "Next Agent" : "Next"}
        </button>
        <button className="secondary" onClick={() => {
          if (currentAgentConfigIdx > 0) {
            setField("currentAgentConfigIdx", currentAgentConfigIdx - 1);
            setField("activeWorkspaceTab", "identity");
          } else {
            setField("step", 15);
          }
        }} disabled={loading}>Back</button>
      </div>
    </div>
  );
}
