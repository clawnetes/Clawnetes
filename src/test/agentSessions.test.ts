import { describe, expect, it } from "vitest";

import { getAgentSessionInitIds } from "../utils/agentSessions";

describe("getAgentSessionInitIds", () => {
  it("returns an empty list when there are no sub-agents", () => {
    expect(getAgentSessionInitIds(null)).toEqual([]);
    expect(getAgentSessionInitIds([])).toEqual([]);
  });

  it("returns non-main ids even when there is only one configured sub-agent", () => {
    expect(getAgentSessionInitIds([{ id: "research" }])).toEqual(["research"]);
  });

  it("filters out the main agent id", () => {
    expect(getAgentSessionInitIds([{ id: "main" }, { id: "reporting" }])).toEqual([
      "reporting",
    ]);
  });
});
