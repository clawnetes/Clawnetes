import { describe, expect, it } from "vitest";
import { wizardReducer, INITIAL_WIZARD_STATE } from "../hooks/useWizardState";

describe("wizardReducer", () => {
  it("returns initial state for unknown action", () => {
    const result = wizardReducer(INITIAL_WIZARD_STATE, { type: "UNKNOWN" as any, field: "step", value: 1 });
    expect(result).toBe(INITIAL_WIZARD_STATE);
  });

  describe("SET_FIELD", () => {
    it("updates a single field", () => {
      const result = wizardReducer(INITIAL_WIZARD_STATE, {
        type: "SET_FIELD", field: "step", value: 5,
      });
      expect(result.step).toBe(5);
      expect(result.mode).toBe("basic"); // unchanged
    });

    it("updates string fields", () => {
      const result = wizardReducer(INITIAL_WIZARD_STATE, {
        type: "SET_FIELD", field: "userName", value: "Alice",
      });
      expect(result.userName).toBe("Alice");
    });

    it("updates boolean fields", () => {
      const result = wizardReducer(INITIAL_WIZARD_STATE, {
        type: "SET_FIELD", field: "loading", value: true,
      });
      expect(result.loading).toBe(true);
    });

    it("updates object fields", () => {
      const newChecks = { node: true, docker: true, openclaw: false };
      const result = wizardReducer(INITIAL_WIZARD_STATE, {
        type: "SET_FIELD", field: "checks", value: newChecks,
      });
      expect(result.checks).toEqual(newChecks);
    });

    it("updates array fields", () => {
      const skills = ["filesystem", "terminal", "web"];
      const result = wizardReducer(INITIAL_WIZARD_STATE, {
        type: "SET_FIELD", field: "selectedSkills", value: skills,
      });
      expect(result.selectedSkills).toEqual(skills);
    });
  });

  describe("BATCH_UPDATE", () => {
    it("updates multiple fields at once", () => {
      const result = wizardReducer(INITIAL_WIZARD_STATE, {
        type: "BATCH_UPDATE",
        updates: {
          step: 16,
          userName: "Bob",
          provider: "openai",
          model: "openai/gpt-5.4",
          loading: true,
        },
      });
      expect(result.step).toBe(16);
      expect(result.userName).toBe("Bob");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("openai/gpt-5.4");
      expect(result.loading).toBe(true);
      // Unchanged fields remain
      expect(result.agentName).toBe("");
      expect(result.mode).toBe("basic");
    });

    it("preserves fields not in updates", () => {
      const modified = wizardReducer(INITIAL_WIZARD_STATE, {
        type: "SET_FIELD", field: "agentName", value: "TestBot",
      });
      const result = wizardReducer(modified, {
        type: "BATCH_UPDATE",
        updates: { userName: "Alice" },
      });
      expect(result.agentName).toBe("TestBot");
      expect(result.userName).toBe("Alice");
    });

    it("handles empty updates", () => {
      const result = wizardReducer(INITIAL_WIZARD_STATE, {
        type: "BATCH_UPDATE", updates: {},
      });
      expect(result).toEqual(INITIAL_WIZARD_STATE);
    });
  });

  describe("INITIAL_WIZARD_STATE", () => {
    it("has correct default values", () => {
      expect(INITIAL_WIZARD_STATE.step).toBe(0.5);
      expect(INITIAL_WIZARD_STATE.mode).toBe("basic");
      expect(INITIAL_WIZARD_STATE.provider).toBe("anthropic");
      expect(INITIAL_WIZARD_STATE.model).toBe("anthropic/claude-opus-4-6");
      expect(INITIAL_WIZARD_STATE.gatewayPort).toBe(18789);
      expect(INITIAL_WIZARD_STATE.selectedSkills).toEqual(["filesystem", "terminal"]);
      expect(INITIAL_WIZARD_STATE.sandboxMode).toBe("none");
      expect(INITIAL_WIZARD_STATE.messagingChannel).toBe("telegram");
      expect(INITIAL_WIZARD_STATE.agentEmoji).toBe("🦞");
    });

    it("has providerAuths with anthropic default", () => {
      expect(INITIAL_WIZARD_STATE.providerAuths).toHaveProperty("anthropic");
      expect(INITIAL_WIZARD_STATE.providerAuths.anthropic.auth_method).toBe("token");
    });
  });
});
