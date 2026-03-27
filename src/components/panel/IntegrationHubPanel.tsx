import { memo } from "react";
import { AVAILABLE_SKILLS } from "../../presets/availableSkills";
import { SKILL_ICONS } from "../../presets/modelsByProvider";
import Badge from "../ui/Badge";

interface IntegrationHubPanelProps {
  activeSkills: string[];
  serviceKeys?: Record<string, string>;
  onToggleSkill?: (skillId: string, enabled: boolean) => void;
  onSetupIntegration?: (skillId: string) => void;
}

interface IntegrationDef {
  skillId: string;
  displayName: string;
}

const MESSAGING_INTEGRATIONS: IntegrationDef[] = [
  { skillId: "slack", displayName: "Slack" },
  { skillId: "wacli", displayName: "WhatsApp" },
  { skillId: "imsg", displayName: "iMessage" },
  { skillId: "bluebubbles", displayName: "iMessage (BlueBubbles)" },
  { skillId: "voice-call", displayName: "Voice Calls" },
];

const SERVICE_INTEGRATIONS: IntegrationDef[] = [
  { skillId: "gog", displayName: "Google Workspace" },
  { skillId: "github", displayName: "GitHub" },
  { skillId: "trello", displayName: "Trello" },
  { skillId: "notion", displayName: "Notion" },
  { skillId: "himalaya", displayName: "Email (IMAP)" },
];

const skillMap = new Map(AVAILABLE_SKILLS.map((s) => [s.id, s]));

function IntegrationCard({
  def,
  isActive,
  hasKey,
  requiresAuth,
  onSetup,
  onDisconnect,
}: {
  def: IntegrationDef;
  isActive: boolean;
  hasKey: boolean;
  requiresAuth: boolean;
  onSetup?: () => void;
  onDisconnect?: () => void;
}) {
  const skill = skillMap.get(def.skillId);
  const iconSrc = SKILL_ICONS[def.skillId] || "/images/terminal.svg";
  const description = skill?.desc || "";

  let status: "connected" | "auth-required" | "neutral" = "neutral";
  let statusLabel = "Available";
  if (isActive && (!requiresAuth || hasKey)) {
    status = "connected";
    statusLabel = "Connected";
  } else if (isActive && requiresAuth && !hasKey) {
    status = "auth-required";
    statusLabel = "Setup Required";
  }

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] hover:bg-[var(--surface-hover)] transition-colors"
      data-testid={`integration-card-${def.skillId}`}
    >
      <img src={iconSrc} alt="" width={24} height={24} className="shrink-0 opacity-80" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-main)]">{def.displayName}</span>
          <Badge variant={status}>{statusLabel}</Badge>
        </div>
        <p className="text-[0.65rem] text-[var(--text-muted)] truncate mt-0.5">{description}</p>
      </div>
      {status === "connected" ? (
        <button
          type="button"
          onClick={onDisconnect}
          disabled={!onDisconnect}
          className="px-2 py-1 text-[0.65rem] font-medium rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-error hover:border-error/30 transition-colors disabled:opacity-40"
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          onClick={onSetup}
          disabled={!onSetup}
          className="px-2 py-1 text-[0.65rem] font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40"
        >
          Setup
        </button>
      )}
    </div>
  );
}

function IntegrationSection({
  title,
  integrations,
  activeSkills,
  serviceKeys,
  onToggleSkill,
  onSetupIntegration,
}: {
  title: string;
  integrations: IntegrationDef[];
  activeSkills: string[];
  serviceKeys: Record<string, string>;
  onToggleSkill?: (skillId: string, enabled: boolean) => void;
  onSetupIntegration?: (skillId: string) => void;
}) {
  return (
    <div>
      <h4 className="text-[0.65rem] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-2">
        {integrations.map((def) => {
          const skill = skillMap.get(def.skillId);
          const isActive = activeSkills.includes(def.skillId);
          const hasKey = Boolean(serviceKeys[def.skillId]);
          const requiresAuth = Boolean(skill?.requiresAuth);

          return (
            <IntegrationCard
              key={def.skillId}
              def={def}
              isActive={isActive}
              hasKey={hasKey}
              requiresAuth={requiresAuth}
              onSetup={onSetupIntegration ? () => onSetupIntegration(def.skillId) : undefined}
              onDisconnect={onToggleSkill ? () => onToggleSkill(def.skillId, false) : undefined}
            />
          );
        })}
        <button
          type="button"
          disabled
          className="w-full py-2 text-[0.65rem] font-medium text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-lg hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Add Custom Integration
        </button>
      </div>
    </div>
  );
}

function IntegrationHubPanel({ activeSkills, serviceKeys = {}, onToggleSkill, onSetupIntegration }: IntegrationHubPanelProps) {
  return (
    <div data-testid="integration-hub-panel" className="space-y-5">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">Integrations</h3>

      <IntegrationSection
        title="Messaging"
        integrations={MESSAGING_INTEGRATIONS}
        activeSkills={activeSkills}
        serviceKeys={serviceKeys}
        onToggleSkill={onToggleSkill}
        onSetupIntegration={onSetupIntegration}
      />

      <IntegrationSection
        title="Services"
        integrations={SERVICE_INTEGRATIONS}
        activeSkills={activeSkills}
        serviceKeys={serviceKeys}
        onToggleSkill={onToggleSkill}
        onSetupIntegration={onSetupIntegration}
      />
    </div>
  );
}

export default memo(IntegrationHubPanel);
