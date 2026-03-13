import { useState } from "react";
import {
  DEFAULT_TOOL_POLICY,
  TOOL_PROFILE_IDS,
  getEffectiveEnabledToolIds,
  getSectionedToolDefinitions,
  getUnknownToolIds,
  setToolProfile,
  toggleToolInPolicy,
} from "../utils/toolSelection";
import type { ToolPolicy } from "../types";

interface ToolPolicyEditorProps {
  policy: ToolPolicy;
  onChange: (policy: ToolPolicy) => void;
  title?: string;
  description?: string;
  showElevatedToggle?: boolean;
}

const PROFILE_LABELS: Record<string, { name: string; description: string }> = {
  minimal: { name: "Minimal", description: "Only session inspection by default." },
  coding: { name: "Coding", description: "Files, runtime, sessions, memory, image." },
  messaging: { name: "Messaging", description: "Message and session routing tools." },
  full: { name: "Full", description: "No base restrictions." },
};

export default function ToolPolicyEditor({
  policy,
  onChange,
  title = "Tool Access",
  description = "Choose a base profile, then enable or disable individual tools.",
  showElevatedToggle = false,
}: ToolPolicyEditorProps) {
  const effectivePolicy = {
    ...DEFAULT_TOOL_POLICY,
    ...policy,
    allow: policy.allow ?? [],
    deny: policy.deny ?? [],
  };
  const enabledTools = getEffectiveEnabledToolIds(effectivePolicy);
  const sections = getSectionedToolDefinitions();
  const unknownTools = getUnknownToolIds(effectivePolicy);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (section: string) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  return (
    <div className="tool-policy-editor">
      <div className="tool-policy-header">
        <div>
          <label>{title}</label>
          <p className="step-description" style={{ marginBottom: 0 }}>{description}</p>
        </div>
        <div className="tool-policy-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => onChange({ ...effectivePolicy, profile: "full", allow: [], deny: [] })}
          >
            Enable All
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => onChange({ ...effectivePolicy, profile: null, allow: [], deny: getSectionedToolDefinitions().flatMap(({ tools }) => tools.map((tool) => tool.id)) })}
          >
            Disable All
          </button>
        </div>
      </div>

      <div className="tool-profile-grid">
        {TOOL_PROFILE_IDS.map((profileId) => {
          const meta = PROFILE_LABELS[profileId];
          const isActive = effectivePolicy.profile === profileId;
          return (
            <button
              type="button"
              key={profileId}
              className={`tool-profile-card ${isActive ? "active" : ""}`}
              onClick={() => onChange(setToolProfile(effectivePolicy, profileId))}
            >
              <span className="tool-profile-name">{meta.name}</span>
              <span className="tool-profile-description">{meta.description}</span>
            </button>
          );
        })}
      </div>

      {showElevatedToggle && (
        <div className="tool-policy-row">
          <div>
            <div className="tool-row-title">Elevated runtime</div>
            <div className="tool-row-description">Allow host-level execution when sandboxed.</div>
          </div>
          <button
            type="button"
            className={`tool-toggle ${effectivePolicy.elevatedEnabled ? "enabled" : ""}`}
            onClick={() => onChange({ ...effectivePolicy, elevatedEnabled: !effectivePolicy.elevatedEnabled })}
            aria-pressed={effectivePolicy.elevatedEnabled}
            aria-label="Toggle elevated runtime"
          >
            <span />
          </button>
        </div>
      )}

      <div className="tool-policy-sections">
        {sections.map(({ section, tools }) => (
          <div key={section} className="tool-policy-section">
            <div className="tool-policy-section-header">
              <div className="tool-policy-section-title">{section}</div>
              <button
                type="button"
                className="tool-policy-section-arrow"
                onClick={() => toggleSection(section)}
                aria-expanded={expandedSections[section] ? "true" : "false"}
                aria-controls={`tool-section-${section}`}
                aria-label={`${expandedSections[section] ? "Collapse" : "Expand"} ${section}`}
              >
                <span
                  aria-hidden="true"
                  className={`accordion-chevron ${expandedSections[section] ? "rotated" : ""}`}
                >
                  ▼
                </span>
              </button>
            </div>
            {expandedSections[section] && (
              <div className="tool-policy-list" id={`tool-section-${section}`}>
                {tools.map((tool) => {
                  const enabled = enabledTools.has(tool.id);
                  return (
                    <div key={tool.id} className="tool-policy-row">
                      <div>
                        <div className="tool-row-title">{tool.name}</div>
                        <div className="tool-row-description">{tool.description}</div>
                      </div>
                      <button
                        type="button"
                        className={`tool-toggle ${enabled ? "enabled" : ""}`}
                        onClick={() => onChange(toggleToolInPolicy(effectivePolicy, tool.id, !enabled))}
                        aria-pressed={enabled}
                        aria-label={`Toggle ${tool.name}`}
                      >
                        <span />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {unknownTools.length > 0 && (
        <div className="tool-policy-section tool-policy-unknown">
          <div className="tool-policy-section-title">Unmapped Overrides</div>
          <p className="step-description">
            These ids are preserved in the config but are not part of the built-in catalog.
          </p>
          <div className="tool-policy-tags">
            {unknownTools.map((toolId) => (
              <span key={toolId} className="tool-policy-tag">{toolId}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
