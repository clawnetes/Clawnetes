import { describe, expect, it } from "vitest";

import { BUSINESS_FUNCTION_PRESETS } from "../presets/businessFunctionPresets";
import { getEffectiveEnabledToolIds } from "../utils/toolSelection";

describe("businessFunctionPresets", () => {
  it("assigns an explicit tool policy to every preset agent", () => {
    for (const preset of Object.values(BUSINESS_FUNCTION_PRESETS)) {
      expect(preset.mainAgent.toolPolicy).toBeDefined();
      for (const agent of preset.subAgents) {
        expect(agent.toolPolicy).toBeDefined();
      }
    }
  });

  it("gives the report generator the coding tools it needs", () => {
    const reportGenerator = BUSINESS_FUNCTION_PRESETS["financial-analyst"].subAgents.find(
      (agent) => agent.id === "reporting",
    );

    expect(reportGenerator?.toolPolicy.profile).toBe("coding");
    const enabledTools = getEffectiveEnabledToolIds(reportGenerator!.toolPolicy);
    expect(enabledTools.has("read")).toBe(true);
    expect(enabledTools.has("edit")).toBe(true);
    expect(enabledTools.has("exec")).toBe(true);
  });

  it("gives research-oriented agents browser and web tools", () => {
    const researchAgent = BUSINESS_FUNCTION_PRESETS["social-media"].subAgents.find(
      (agent) => agent.id === "research",
    );

    const enabledTools = getEffectiveEnabledToolIds(researchAgent!.toolPolicy);
    expect(enabledTools.has("browser")).toBe(true);
    expect(enabledTools.has("web_search")).toBe(true);
    expect(enabledTools.has("web_fetch")).toBe(true);
  });
});
