import { memo, useState, useCallback } from "react";
import { PERSONA_TEMPLATES } from "../../presets/personaTemplates";

export type IdentityTab = "identity" | "soul" | "tools" | "agents" | "heartbeat" | "memory";

interface IdentityEditorPanelProps {
  identityMd?: string;
  soulMd?: string;
  toolsMd?: string;
  agentsMd?: string;
  heartbeatMd?: string;
  memoryMd?: string;
  onSave?: (tab: IdentityTab, content: string) => void;
  saving?: boolean;
}

const IDENTITY_TABS: { id: IdentityTab; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "soul", label: "Soul" },
  { id: "tools", label: "Tools" },
  { id: "agents", label: "Agents" },
  { id: "heartbeat", label: "Heartbeat" },
  { id: "memory", label: "Memory" },
];

const templateEntries = Object.entries(PERSONA_TEMPLATES).map(([key, tmpl]) => ({
  key,
  name: tmpl.name,
}));

function IdentityEditorPanel({
  identityMd = "",
  soulMd = "",
  toolsMd = "",
  agentsMd = "",
  heartbeatMd = "",
  memoryMd = "",
  onSave,
  saving = false,
}: IdentityEditorPanelProps) {
  const [activeTab, setActiveTab] = useState<IdentityTab>("identity");

  const contentMap: Record<IdentityTab, string> = {
    identity: identityMd,
    soul: soulMd,
    tools: toolsMd,
    agents: agentsMd,
    heartbeat: heartbeatMd,
    memory: memoryMd,
  };

  const [drafts, setDrafts] = useState<Partial<Record<IdentityTab, string>>>({});

  const currentContent = drafts[activeTab] ?? contentMap[activeTab];
  const isDirty = drafts[activeTab] !== undefined && drafts[activeTab] !== contentMap[activeTab];

  const handleChange = useCallback(
    (value: string) => {
      setDrafts((prev) => ({ ...prev, [activeTab]: value }));
    },
    [activeTab],
  );

  const handleSave = useCallback(() => {
    if (!onSave || !isDirty) return;
    onSave(activeTab, currentContent);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[activeTab];
      return next;
    });
  }, [onSave, isDirty, activeTab, currentContent]);

  const handleTemplateApply = useCallback(
    (templateKey: string) => {
      const tmpl = PERSONA_TEMPLATES[templateKey];
      if (!tmpl) return;
      setDrafts((prev) => ({
        ...prev,
        identity: tmpl.identity,
        soul: tmpl.soul,
      }));
      setActiveTab("identity");
    },
    [],
  );

  return (
    <div data-testid="identity-editor-panel">
      <h3 className="text-sm font-semibold text-[var(--text-strong)] mb-3">Identity Editor</h3>

      {/* Template selector */}
      <div className="mb-3">
        <label className="text-[0.65rem] font-semibold text-[var(--text-subtle)] uppercase tracking-wider block mb-1">
          Apply Template
        </label>
        <select
          className="w-full text-xs rounded-md border border-[var(--border)] bg-[var(--surface-0)] text-[var(--text-main)] px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) handleTemplateApply(e.target.value);
            e.target.value = "";
          }}
          data-testid="template-selector"
        >
          <option value="" disabled>
            Choose a persona template...
          </option>
          {templateEntries.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-0.5 border-b border-[var(--border)] mb-3" role="tablist">
        {IDENTITY_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const tabDirty = drafts[tab.id] !== undefined && drafts[tab.id] !== contentMap[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`px-2 py-1.5 text-[0.65rem] font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-[var(--accent)] text-[var(--text-main)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
            >
              {tab.label}
              {tabDirty && <span className="ml-1 text-[var(--accent)]" aria-label="unsaved changes">*</span>}
            </button>
          );
        })}
      </div>

      {/* Editor textarea */}
      <textarea
        className="w-full h-64 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] text-[var(--text-main)] text-xs font-mono p-3 resize-y focus:outline-none focus:ring-1 focus:ring-[var(--accent)] leading-relaxed"
        value={currentContent}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={`Enter ${activeTab}.md content...`}
        spellCheck={false}
        data-testid="identity-editor-textarea"
      />

      {/* Status and buttons */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[0.6rem] text-[var(--text-muted)]">
          {isDirty ? "Unsaved changes" : "No changes"}
        </span>
        {isDirty && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDrafts((prev) => {
                  const next = { ...prev };
                  delete next[activeTab];
                  return next;
                });
              }}
              className="px-3 py-2 rounded-md bg-[var(--surface-hover)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-active)] transition-colors"
              data-testid="identity-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !onSave}
              className="px-3 py-2 text-xs font-medium rounded-md bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="identity-save-button"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(IdentityEditorPanel);
