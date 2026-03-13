import { describe, expect, it } from "vitest";

import { AVAILABLE_SKILLS } from "../presets/availableSkills";
import {
  TOOL_DEFINITIONS,
  deriveToolPolicyFromLegacy,
  getSkillIdSet,
  normalizeSkillAndToolSelection,
  normalizeToolPolicy,
  sanitizeAllowedTools,
  setToolProfile,
} from "../utils/toolSelection";

describe("toolSelection", () => {
  const knownSkillIds = getSkillIdSet(AVAILABLE_SKILLS);

  it("moves skill ids from allowed tools into skills", () => {
    expect(
      normalizeSkillAndToolSelection(
        ["github"],
        ["filesystem", "github", "weather", "filesystem"],
        knownSkillIds,
      ),
    ).toEqual({
      skills: ["github", "weather"],
      allowedTools: ["read", "write", "edit", "apply_patch"],
    });
  });

  it("keeps unknown non-skill tool ids in allowed tools", () => {
    expect(
      normalizeSkillAndToolSelection(
        [],
        ["exec", "read", "write"],
        knownSkillIds,
      ),
    ).toEqual({
      skills: [],
      allowedTools: ["exec", "read", "write"],
    });
  });

  it("strips skill ids when sanitizing allowed tools", () => {
    expect(
      sanitizeAllowedTools(["browser", "github", "network", "github"], knownSkillIds),
    ).toEqual(["browser", "web_search", "web_fetch"]);
  });

  it("keeps tool ids distinct from skill ids", () => {
    const overlap = TOOL_DEFINITIONS.filter((tool) => knownSkillIds.has(tool.id));
    expect(overlap).toEqual([]);
  });

  it("maps legacy all-tools mode to the full profile", () => {
    expect(deriveToolPolicyFromLegacy("all", [], [], knownSkillIds)).toEqual({
      profile: "full",
      allow: [],
      deny: [],
      elevatedEnabled: false,
    });
  });

  it("normalizes alias ids inside tool policies", () => {
    expect(
      normalizeToolPolicy({ profile: "minimal", allow: ["sessions_status"], deny: [] }, knownSkillIds),
    ).toEqual({
      profile: "minimal",
      allow: ["session_status"],
      deny: [],
      elevatedEnabled: false,
    });
  });

  it("resets overrides when changing the selected profile", () => {
    expect(
      setToolProfile({
        profile: "minimal",
        allow: ["read"],
        deny: ["session_status"],
        elevatedEnabled: true,
      }, "coding"),
    ).toEqual({
      profile: "coding",
      allow: [],
      deny: [],
      elevatedEnabled: true,
    });
  });
});
