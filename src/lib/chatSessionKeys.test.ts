import { describe, expect, it } from "vitest";

import { isTerminalSessionSnapshot, sessionKeysMatch } from "./chatSessionKeys";

describe("chatSessionKeys", () => {
  it("matches canonical and request session keys for the active agent", () => {
    expect(
      sessionKeysMatch({
        left: "agent:main:main",
        right: "main",
        agentId: "main",
      }),
    ).toBe(true);
  });

  it("does not match another agent's canonical key to the active alias", () => {
    expect(
      sessionKeysMatch({
        left: "agent:ops:main",
        right: "main",
        agentId: "main",
      }),
    ).toBe(false);
  });

  it("treats ended or aborted snapshots as terminal", () => {
    expect(isTerminalSessionSnapshot({ status: "done" })).toBe(true);
    expect(isTerminalSessionSnapshot({ endedAt: 123 })).toBe(true);
    expect(isTerminalSessionSnapshot({ abortedLastRun: true })).toBe(true);
    expect(isTerminalSessionSnapshot({ status: "running" })).toBe(false);
  });
});
