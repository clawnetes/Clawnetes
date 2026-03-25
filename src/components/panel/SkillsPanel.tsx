import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AVAILABLE_SKILLS } from "../../presets/availableSkills";
import { SKILL_ICONS } from "../../presets/modelsByProvider";
import { SKILL_CATEGORIES } from "../../presets/skillCategories";
import SearchInput from "../ui/SearchInput";
import ToggleSwitch from "../ui/ToggleSwitch";
import Badge from "../ui/Badge";

interface SkillsPanelProps {
  activeSkills: string[];
  serviceKeys?: Record<string, string>;
  onSaveSkillsConfig?: (skills: string[], serviceKeys: Record<string, string>) => void;
  saving?: boolean;
}

const skillMap = new Map(AVAILABLE_SKILLS.map((s) => [s.id, s]));

function SkillsPanel({ activeSkills, serviceKeys = {}, onSaveSkillsConfig, saving }: SkillsPanelProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draftSkills, setDraftSkills] = useState<string[]>(activeSkills);
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>(serviceKeys);

  // Re-sync drafts when committed props change (e.g. after save)
  const prevActiveSkillsRef = useRef(activeSkills);
  const prevServiceKeysRef = useRef(serviceKeys);
  useEffect(() => {
    if (prevActiveSkillsRef.current !== activeSkills) {
      setDraftSkills(activeSkills);
      prevActiveSkillsRef.current = activeSkills;
    }
    if (prevServiceKeysRef.current !== serviceKeys) {
      setDraftKeys(serviceKeys);
      prevServiceKeysRef.current = serviceKeys;
    }
  }, [activeSkills, serviceKeys]);

  const isDirty = useMemo(() => {
    const skillsChanged =
      draftSkills.length !== activeSkills.length ||
      draftSkills.some((s) => !activeSkills.includes(s)) ||
      activeSkills.some((s) => !draftSkills.includes(s));
    const allKeyIds = new Set([...Object.keys(draftKeys), ...Object.keys(serviceKeys)]);
    const keysChanged = [...allKeyIds].some(
      (k) => (draftKeys[k] ?? "") !== (serviceKeys[k] ?? ""),
    );
    return skillsChanged || keysChanged;
  }, [draftSkills, draftKeys, activeSkills, serviceKeys]);

  const query = search.toLowerCase().trim();

  function matchesSearch(skillId: string) {
    if (!query) return true;
    const skill = skillMap.get(skillId);
    if (!skill) return false;
    return skill.name.toLowerCase().includes(query) || skill.desc.toLowerCase().includes(query);
  }

  function toggleCategory(catId: string) {
    setCollapsed((prev) => ({ ...prev, [catId]: !prev[catId] }));
  }

  function handleToggle(skillId: string, enabled: boolean) {
    setDraftSkills((prev) =>
      enabled ? [...prev, skillId] : prev.filter((s) => s !== skillId),
    );
  }

  function handleKeyChange(skillId: string, value: string) {
    setDraftKeys((prev) => ({ ...prev, [skillId]: value }));
  }

  function handleSave() {
    // Filter out empty-string keys
    const cleanedKeys: Record<string, string> = {};
    for (const [k, v] of Object.entries(draftKeys)) {
      if (v) cleanedKeys[k] = v;
    }
    onSaveSkillsConfig?.(draftSkills, cleanedKeys);
  }

  return (
    <div data-testid="skills-panel">
      <h3 className="text-sm font-semibold text-[var(--text-strong)] mb-3">Skills & Tools</h3>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search skills..."
        className="mb-3"
      />

      <div className="space-y-2">
        {SKILL_CATEGORIES.filter((cat) => cat.skills.length > 0).map((category) => {
          const filteredSkills = category.skills.filter(matchesSearch);
          if (query && filteredSkills.length === 0) return null;

          const isCollapsed = collapsed[category.id] && !query;
          const activeCount = filteredSkills.filter((id) => draftSkills.includes(id)).length;

          return (
            <div key={category.id} className="rounded-lg border border-[var(--border)] overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCategory(category.id)}
                className="w-full flex items-center justify-between px-3 py-2 bg-[var(--surface-0)] hover:bg-[var(--surface-hover)] transition-colors"
                aria-expanded={!isCollapsed}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--text-main)]">{category.label}</span>
                  {activeCount > 0 && (
                    <Badge variant="active">{activeCount} active</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[0.65rem] text-[var(--text-muted)]">{filteredSkills.length}</span>
                  <svg
                    width="12" height="12" viewBox="0 0 12 12" fill="none"
                    className={`text-[var(--text-muted)] transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                  >
                    <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>

              {!isCollapsed && (
                <div className="divide-y divide-[var(--border)]">
                  {filteredSkills.map((skillId) => {
                    const skill = skillMap.get(skillId);
                    if (!skill) return null;
                    const isActive = draftSkills.includes(skillId);
                    const needsAuth = skill.requiresAuth && skill.authMode !== "oauth" && !draftKeys[skillId];
                    const showKeyInput = isActive && skill.requiresAuth && skill.authMode !== "oauth";
                    const iconSrc = SKILL_ICONS[skillId] || "/images/terminal.svg";

                    return (
                      <div
                        key={skillId}
                        className="bg-[var(--surface-panel)]"
                        data-testid={`skill-card-${skillId}`}
                      >
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          <img src={iconSrc} alt="" width={18} height={18} className="shrink-0 opacity-70" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-[var(--text-main)] truncate">{skill.name}</span>
                              {isActive && <Badge variant="active">Active</Badge>}
                              {needsAuth && isActive && <Badge variant="auth-required">Key needed</Badge>}
                            </div>
                            <p className="text-[0.65rem] text-[var(--text-muted)] truncate mt-0.5">{skill.desc}</p>
                          </div>
                          <ToggleSwitch
                            checked={isActive}
                            onChange={(checked) => handleToggle(skillId, checked)}
                            disabled={!onSaveSkillsConfig}
                            label={`Toggle ${skill.name}`}
                          />
                        </div>
                        {showKeyInput && (
                          <div className="px-3 pb-2.5 pl-[42px]">
                            <input
                              type="password"
                              placeholder={skill.authPlaceholder || "API Key"}
                              value={draftKeys[skillId] || ""}
                              onChange={(e) => handleKeyChange(skillId, e.target.value)}
                              className="w-full text-xs px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface-0)] text-[var(--text-main)] placeholder-[var(--text-muted)]"
                              data-testid={`skill-key-input-${skillId}`}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Save footer */}
      <div className="sticky bottom-0 bg-[var(--surface-panel)] border-t border-[var(--border)] pt-3 mt-4 flex items-center gap-3" data-testid="skills-save-footer">
        {isDirty && (
          <span className="text-xs text-amber-500 font-medium" data-testid="unsaved-indicator">Unsaved changes</span>
        )}
        <button
          type="button"
          disabled={!isDirty || saving}
          onClick={handleSave}
          className="ml-auto px-3 py-2 text-xs font-medium rounded-md bg-[var(--accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          data-testid="skills-save-button"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

export default memo(SkillsPanel);
