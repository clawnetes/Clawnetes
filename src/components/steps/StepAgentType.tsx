import { useWizard } from "../../context/WizardContext";
import type { AgentTypeId } from "../../types";

interface StepAgentTypeProps {
  applyAgentTypePreset: (typeId: AgentTypeId) => void;
}

export default function StepAgentType({ applyAgentTypePreset }: StepAgentTypeProps) {
  const { state, dispatch } = useWizard();
  const { agentType } = state;
  const isPresetAgent = agentType !== "custom";

  const setStep = (v: number) => dispatch({ type: "SET_FIELD", field: "step", value: v });

  const agentTypes: { id: AgentTypeId; name: string; emoji: string; desc: string }[] = [
    { id: "coding-assistant", name: "Coding Assistant", emoji: "👨‍💻", desc: "A senior software engineer that writes clean, secure code." },
    { id: "office-assistant", name: "Office Assistant", emoji: "🤵", desc: "A professional executive assistant for email, tasks, and comms." },
    { id: "travel-planner", name: "Travel Planner", emoji: "🌍", desc: "An expert travel agent that plans trips and finds deals." },
    { id: "custom", name: "Custom", emoji: "🔧", desc: "Configure everything manually from scratch." },
  ];

  return (
    <div className="step-view" data-testid="step-agent-type">
      <h2>Agent Type</h2>
      <p className="step-description">Pick a pre-configured OpenClaw agent type or build your own from scratch.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        {agentTypes.map(t => (
          <div
            key={t.id}
            className={`mode-card ${agentType === t.id ? "active" : ""}`}
            onClick={() => applyAgentTypePreset(t.id)}
            style={{
              padding: "1.5rem",
              borderRadius: "12px",
              border: agentType === t.id ? "2px solid var(--primary)" : "1px solid var(--border)",
              backgroundColor: agentType === t.id ? "rgba(255, 59, 48, 0.08)" : "var(--bg-card)",
              cursor: "pointer",
              textAlign: "center"
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>{t.emoji}</div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{t.name}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{t.desc}</div>
          </div>
        ))}
      </div>
      <div className="button-group" style={{ marginTop: "1.5rem" }}>
        <button className="primary" data-testid="btn-next" onClick={() => {
          if (isPresetAgent) {
            setStep(6.7);
          } else {
            setStep(8);
          }
        }}>Next</button>
        <button className="secondary" onClick={() => setStep(6)}>Back</button>
      </div>
    </div>
  );
}
