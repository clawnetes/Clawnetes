import { describe, it, expect } from "vitest";
import {
  getActiveAgentConfig,
  patchAgentConfig,
  type AppState,
  type ActiveAgentView,
} from "../agentConfigHelpers";
import { AgentConfigData, ToolPolicy } from "../../types";

const defaultToolPolicy: ToolPolicy = {
  profile: "minimal",
  allow: [],
  deny: [],
};

const mockMainState: AppState = {
  provider: "anthropic",
  model: "claude-opus-4-6",
  fallbackModels: ["claude-sonnet-4-6"],
  selectedSkills: ["github", "web-search"],
  vibe: "helpful assistant 🤖",
  identityMd: "Main identity",
  userMd: "Main user",
  soulMd: "Main soul",
  toolsMd: "Main tools",
  agentsMd: "Main agents",
  heartbeatMd: "Main heartbeat",
  memoryMd: "Main memory",
  heartbeatMode: "30m",
  idleTimeoutMs: 60000,
  memoryEnabled: true,
  sandboxMode: "off",
  toolPolicy: defaultToolPolicy,
  agentConfigs: [],
};

const mockSubAgent: AgentConfigData = {
  id: "agent-1",
  name: "Coding Assistant",
  model: "claude-opus-4-6",
  fallbackModels: [],
  skills: ["github", "coding-agent"],
  vibe: "expert coder 💻",
  emoji: "💻",
  identityMd: "Sub identity",
  userMd: "Sub user",
  soulMd: "Sub soul",
  toolsMd: "Sub tools",
  agentsMd: "Sub agents",
  heartbeatMd: "Sub heartbeat",
  memoryMd: "Sub memory",
  heartbeatMode: "1h",
  idleTimeoutMs: 120000,
  memoryEnabled: true,
  sandboxMode: "all",
  toolPolicy: { profile: "coding", allow: [], deny: [] },
  cronJobs: [],
  provider: "anthropic",
};

describe("agentConfigHelpers", () => {
  describe("getActiveAgentConfig", () => {
    it("returns main agent config when activeAgentId is null", () => {
      const view = getActiveAgentConfig(mockMainState, null);

      expect(view.model).toBe("claude-opus-4-6");
      expect(view.skills).toEqual(["github", "web-search"]);
      expect(view.heartbeatMode).toBe("30m");
      expect(view.provider).toBe("anthropic");
    });

    it("returns main agent config when activeAgentId is 'main'", () => {
      const view = getActiveAgentConfig(mockMainState, "main");

      expect(view.model).toBe("claude-opus-4-6");
      expect(view.skills).toEqual(["github", "web-search"]);
      expect(view.heartbeatMode).toBe("30m");
    });

    it("returns sub-agent config when activeAgentId matches", () => {
      const state: AppState = {
        ...mockMainState,
        agentConfigs: [mockSubAgent],
      };

      const view = getActiveAgentConfig(state, "agent-1");

      expect(view.model).toBe("claude-opus-4-6");
      expect(view.skills).toEqual(["github", "coding-agent"]);
      expect(view.heartbeatMode).toBe("1h");
      expect(view.emoji).toBe("💻");
      expect(view.sandboxMode).toBe("all");
    });

    it("falls back to main agent when sub-agent not found", () => {
      const state: AppState = {
        ...mockMainState,
        agentConfigs: [mockSubAgent],
      };

      const view = getActiveAgentConfig(state, "nonexistent");

      expect(view.model).toBe("claude-opus-4-6");
      expect(view.skills).toEqual(["github", "web-search"]);
    });

    it("provides defaults for missing heartbeat/memory fields", () => {
      const state: AppState = {
        ...mockMainState,
        heartbeatMd: "",
        memoryMd: "",
        heartbeatMode: "",
        idleTimeoutMs: 0,
        memoryEnabled: false,
      };

      const view = getActiveAgentConfig(state, null);

      expect(view.heartbeatMd).toBe("");
      expect(view.memoryMd).toBe("");
      expect(view.heartbeatMode).toBe("never"); // Defaults to "never"
      expect(view.memoryEnabled).toBe(false);
    });
  });

  describe("patchAgentConfig", () => {
    it("patches main agent when activeAgentId is null", () => {
      const patch: Partial<ActiveAgentView> = {
        model: "gpt-4",
        skills: ["chatgpt-integration"],
      };

      const result = patchAgentConfig(mockMainState, null, patch);

      expect(result.model).toBe("gpt-4");
      expect(result.selectedSkills).toEqual(["chatgpt-integration"]);
      expect(result.heartbeatMode).toBe("30m"); // Unchanged
    });

    it("patches main agent when activeAgentId is 'main'", () => {
      const patch: Partial<ActiveAgentView> = {
        heartbeatMode: "1h",
        idleTimeoutMs: 120000,
      };

      const result = patchAgentConfig(mockMainState, "main", patch);

      expect(result.heartbeatMode).toBe("1h");
      expect(result.idleTimeoutMs).toBe(120000);
    });

    it("patches sub-agent when activeAgentId matches", () => {
      const state: AppState = {
        ...mockMainState,
        agentConfigs: [mockSubAgent],
      };

      const patch: Partial<ActiveAgentView> = {
        skills: ["github", "new-skill"],
        heartbeatMode: "30m",
      };

      const result = patchAgentConfig(state, "agent-1", patch);

      expect(result.agentConfigs).toBeDefined();
      const updatedAgent = result.agentConfigs![0];
      expect(updatedAgent.skills).toEqual(["github", "new-skill"]);
      expect(updatedAgent.heartbeatMode).toBe("30m");
      expect(updatedAgent.emoji).toBe("💻"); // Unchanged
    });

    it("falls back to main agent when sub-agent not found", () => {
      const state: AppState = {
        ...mockMainState,
        agentConfigs: [mockSubAgent],
      };

      const patch: Partial<ActiveAgentView> = {
        model: "gpt-4",
      };

      const result = patchAgentConfig(state, "nonexistent", patch);

      // When patching a nonexistent sub-agent, we fallback to patching main agent
      expect(result.model).toBe("gpt-4");
      expect(result.selectedSkills).toEqual(["github", "web-search"]); // Main agent skills unchanged
    });

    it("preserves unpatched fields in sub-agent", () => {
      const state: AppState = {
        ...mockMainState,
        agentConfigs: [mockSubAgent],
      };

      const patch: Partial<ActiveAgentView> = {
        vibe: "new vibe 🎉",
      };

      const result = patchAgentConfig(state, "agent-1", patch);

      const updatedAgent = result.agentConfigs![0];
      expect(updatedAgent.vibe).toBe("new vibe 🎉");
      expect(updatedAgent.model).toBe("claude-opus-4-6"); // Unchanged
      expect(updatedAgent.skills).toEqual(["github", "coding-agent"]); // Unchanged
      expect(updatedAgent.heartbeatMode).toBe("1h"); // Unchanged
    });

    it("handles boolean idleTimeoutMs correctly (not undefined fallback)", () => {
      const state: AppState = {
        ...mockMainState,
        agentConfigs: [mockSubAgent],
      };

      const patch: Partial<ActiveAgentView> = {
        idleTimeoutMs: 0, // Explicitly set to 0
      };

      const result = patchAgentConfig(state, "agent-1", patch);

      const updatedAgent = result.agentConfigs![0];
      expect(updatedAgent.idleTimeoutMs).toBe(0);
    });

    it("handles boolean memoryEnabled correctly", () => {
      const state: AppState = {
        ...mockMainState,
        agentConfigs: [mockSubAgent],
      };

      const patch: Partial<ActiveAgentView> = {
        memoryEnabled: false,
      };

      const result = patchAgentConfig(state, "agent-1", patch);

      const updatedAgent = result.agentConfigs![0];
      expect(updatedAgent.memoryEnabled).toBe(false);
    });
  });
});
