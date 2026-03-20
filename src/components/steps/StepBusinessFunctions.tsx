import { useWizard } from "../../context/WizardContext";
import { BUSINESS_FUNCTION_PRESETS } from "../../presets/businessFunctionPresets";
import { createInheritedToolPolicy, normalizeToolPolicy } from "../../utils/toolSelection";
import type { AgentConfigData, CronJobConfig } from "../../types";

export default function StepBusinessFunctions() {
  const { state, dispatch } = useWizard();
  const {
    selectedBusinessFunctions, numAgents, enableMultiAgent, agentConfigs,
    cronJobs, model, agentEmoji, agentType, loading,
  } = state;

  const setField = (field: string, value: unknown) =>
    dispatch({ type: "SET_FIELD", field: field as any, value });

  const isPresetAgent = agentType !== "custom";

  return (
    <div className="step-view" data-testid="step-business">
      <h2>Build your AI powered business</h2>
      <p className="step-description">Select specialized business functions to add pre-configured sub-agents to your setup.</p>

      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          {Object.values(BUSINESS_FUNCTION_PRESETS).map(bf => (
            <div
              key={bf.id}
              className={`mode-card ${selectedBusinessFunctions.includes(bf.id) ? "active" : ""}`}
              onClick={() => {
                setField("selectedBusinessFunctions",
                  selectedBusinessFunctions.includes(bf.id)
                    ? selectedBusinessFunctions.filter((id: string) => id !== bf.id)
                    : [...selectedBusinessFunctions, bf.id]
                );
              }}
              style={{
                padding: "1rem", borderRadius: "10px",
                border: selectedBusinessFunctions.includes(bf.id) ? "2px solid var(--primary)" : "1px solid var(--border)",
                backgroundColor: selectedBusinessFunctions.includes(bf.id) ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
                cursor: "pointer"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "1.2rem" }}>{bf.emoji}</span>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{bf.name}</span>
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{bf.description}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                {bf.subAgents.length} sub-agent{bf.subAgents.length !== 1 ? "s" : ""}
              </div>
            </div>
          ))}
          <div
            className={`mode-card ${selectedBusinessFunctions.includes("custom-team") ? "active" : ""}`}
            onClick={() => {
              setField("selectedBusinessFunctions",
                selectedBusinessFunctions.includes("custom-team")
                  ? selectedBusinessFunctions.filter((id: string) => id !== "custom-team")
                  : [...selectedBusinessFunctions, "custom-team"]
              );
            }}
            style={{
              padding: "1rem", borderRadius: "10px",
              border: selectedBusinessFunctions.includes("custom-team") ? "2px solid var(--primary)" : "1px solid var(--border)",
              backgroundColor: selectedBusinessFunctions.includes("custom-team") ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
              cursor: "pointer"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ fontSize: "1.2rem" }}>🛠️</span>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Custom team of agents</span>
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Manually configure a custom multi-agent team.</div>
          </div>
        </div>

        {selectedBusinessFunctions.includes("custom-team") && (
          <div className="form-group" style={{ marginTop: "1rem" }}>
            <label>Number of Custom Agents</label>
            <input
              type="number" min="1" max="5" value={numAgents}
              onChange={(e) => { const num = parseInt(e.target.value) || 1; setField("numAgents", Math.max(1, Math.min(5, num))); }}
              autoComplete="off"
            />
          </div>
        )}
      </div>

      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" data-testid="btn-next" onClick={() => {
          let willEnableMultiAgent = enableMultiAgent;
          let nextAgentConfigs = [...agentConfigs];
          const allCronJobs: CronJobConfig[] = [...cronJobs];

          const presetFunctions = selectedBusinessFunctions.filter((id: string) => id !== "custom-team");
          if (presetFunctions.length > 0) {
            const allAgents: AgentConfigData[] = [];
            for (const bfId of presetFunctions) {
              const bf = BUSINESS_FUNCTION_PRESETS[bfId];
              if (!bf) continue;
              for (const sub of bf.subAgents) {
                allAgents.push({
                  id: sub.id, name: sub.name, model: sub.model, fallbackModels: [],
                  skills: sub.skills, vibe: "", emoji: "🤖",
                  identityMd: sub.identityMd, userMd: "", soulMd: sub.soulMd,
                  toolsMd: sub.toolsMd || "", agentsMd: sub.agentsMd || "",
                  toolPolicy: normalizeToolPolicy(sub.toolPolicy), cronJobs: [],
                });
              }
              allCronJobs.push(...bf.cronJobs);
            }
            if (allAgents.length > 0) {
              willEnableMultiAgent = true;
              nextAgentConfigs = [...nextAgentConfigs, ...allAgents];
            }
          }

          if (selectedBusinessFunctions.includes("custom-team")) {
            willEnableMultiAgent = true;
            const existingCount = nextAgentConfigs.length;
            if (existingCount < numAgents) {
              for (let i = existingCount; i < numAgents; i++) {
                nextAgentConfigs.push({
                  id: `agent-${i + 1}`, name: `Agent ${i + 1}`, model: model,
                  fallbackModels: [], skills: [], vibe: "", emoji: agentEmoji,
                  identityMd: "", userMd: "", soulMd: "", toolsMd: "", agentsMd: "",
                  toolPolicy: createInheritedToolPolicy(), cronJobs: [],
                });
              }
            }
          }

          dispatch({ type: "BATCH_UPDATE", updates: {
            cronJobs: allCronJobs,
            enableMultiAgent: willEnableMultiAgent,
            agentConfigs: nextAgentConfigs,
            numAgents: nextAgentConfigs.length || numAgents,
          }});

          if (willEnableMultiAgent && nextAgentConfigs.length > 0) {
            dispatch({ type: "BATCH_UPDATE", updates: {
              currentAgentConfigIdx: 0, activeWorkspaceTab: "identity", step: 15.5
            }});
          } else {
            setField("step", 15.7);
          }
        }} disabled={loading}>
          {selectedBusinessFunctions.length > 0 ? "Configure Agents" : "Next"}
        </button>
        <button className="secondary" onClick={() => setField("step", isPresetAgent ? 10.5 : 11.1)} disabled={loading}>Back</button>
      </div>
    </div>
  );
}
