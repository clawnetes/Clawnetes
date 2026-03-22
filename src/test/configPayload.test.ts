import { describe, expect, it } from "vitest";
import { constructConfigPayload, type ConfigPayloadInput } from "../utils/configPayload";
import type { ProviderAuthConfig, ToolPolicy, AgentConfigData } from "../types";
import { DEFAULT_TOOL_POLICY } from "../utils/toolSelection";

function createDefaultInput(overrides: Partial<ConfigPayloadInput> = {}): ConfigPayloadInput {
  return {
    provider: "anthropic",
    apiKey: "sk-ant-test-key",
    authMethod: "token",
    model: "anthropic/claude-opus-4-6",
    userName: "Test User",
    agentName: "TestBot",
    agentEmoji: "🦞",
    agentType: "custom",
    telegramToken: "",
    gatewayPort: 18789,
    gatewayBind: "loopback",
    gatewayAuthMode: "token",
    tailscaleMode: "off",
    nodeManager: "npm",
    selectedSkills: ["filesystem", "terminal"],
    serviceKeys: {},
    providerAuths: {
      anthropic: { auth_method: "token", token: "sk-ant-test-key", profile_key: null, profile: null, oauth_provider_id: null },
    },
    sandboxMode: "none",
    toolPolicy: DEFAULT_TOOL_POLICY,
    enableFallbacks: false,
    fallbackModels: [],
    heartbeatMode: "1h",
    idleTimeoutMs: 3600000,
    identityMd: "",
    userMd: "",
    soulMd: "",
    toolsMd: "",
    agentsMd: "",
    heartbeatMd: "",
    memoryMd: "",
    memoryEnabled: false,
    enableMultiAgent: false,
    agentConfigs: [],
    isPaired: false,
    cronJobs: [],
    localBaseUrl: "http://localhost:8080",
    lmstudioBaseUrl: "http://localhost:1234",
    thinkingLevel: "adaptive",
    messagingChannel: "none",
    whatsappDmPolicy: "allowlist",
    whatsappPhoneNumber: "",
    mode: "basic",
    ...overrides,
  };
}

describe("constructConfigPayload", () => {
  describe("basic custom agent (minimal config)", () => {
    it("includes all required fields", () => {
      const payload = constructConfigPayload(createDefaultInput());

      expect(payload.provider).toBe("anthropic");
      expect(payload.api_key).toBe("sk-ant-test-key");
      expect(payload.auth_method).toBe("token");
      expect(payload.model).toBe("anthropic/claude-opus-4-6");
      expect(payload.user_name).toBe("Test User");
      expect(payload.agent_name).toBe("TestBot");
      expect(payload.agent_vibe).toBe("");
      expect(payload.gateway_port).toBe(18789);
      expect(payload.gateway_bind).toBe("loopback");
      expect(payload.gateway_auth_mode).toBe("token");
      expect(payload.tailscale_mode).toBe("off");
      expect(payload.node_manager).toBe("npm");
      expect(payload.skills).toEqual(["filesystem", "terminal"]);
      expect(payload.service_keys).toEqual({});
    });

    it("generates default identity_md for custom agent without identityMd", () => {
      const payload = constructConfigPayload(createDefaultInput());
      expect(payload.identity_md).toContain("TestBot");
      expect(payload.identity_md).toContain("🦞");
      expect(payload.identity_md).toContain("Managed by Clawnetes");
    });

    it("sets tools_mode to 'all' for custom basic mode", () => {
      const payload = constructConfigPayload(createDefaultInput());
      expect(payload.tools_mode).toBe("all");
    });

    it("keeps sandbox explicit and nullifies the remaining advanced fields for custom basic mode", () => {
      const payload = constructConfigPayload(createDefaultInput());
      expect(payload.sandbox_mode).toBe("off");
      expect(payload.tools_profile).toBeNull();
      expect(payload.allowed_tools).toBeNull();
      expect(payload.denied_tools).toBeNull();
      expect(payload.fallback_models).toBeNull();
      expect(payload.heartbeat_mode).toBeNull();
      expect(payload.idle_timeout_ms).toBeNull();
      expect(payload.user_md).toBeNull();
      expect(payload.soul_md).toBeNull();
      expect(payload.tools_md).toBeNull();
      expect(payload.agents_md).toBeNull();
      expect(payload.heartbeat_md).toBeNull();
      expect(payload.memory_md).toBeNull();
      expect(payload.memory_enabled).toBe(false);
    });

    it("sets preserve_state from isPaired", () => {
      const unpaired = constructConfigPayload(createDefaultInput({ isPaired: false }));
      expect(unpaired.preserve_state).toBe(false);

      const paired = constructConfigPayload(createDefaultInput({ isPaired: true }));
      expect(paired.preserve_state).toBe(true);
    });

    it("sets agents to null when multi-agent is disabled", () => {
      const payload = constructConfigPayload(createDefaultInput());
      expect(payload.agents).toBeNull();
    });

    it("sets cron_jobs to null when empty", () => {
      const payload = constructConfigPayload(createDefaultInput());
      expect(payload.cron_jobs).toBeNull();
    });
  });

  describe("preset agent", () => {
    it("includes advanced fields for preset agents even in basic mode", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        mode: "basic",
        sandboxMode: "partial",
        heartbeatMode: "1h",
        identityMd: "# Custom Identity",
        soulMd: "# Custom Soul",
      }));

      expect(payload.sandbox_mode).toBe("non-main");
      expect(payload.heartbeat_mode).toBe("1h");
      expect(payload.identity_md).toBe("# Custom Identity");
      expect(payload.soul_md).toBe("# Custom Soul");
      expect(payload.agent_type).toBe("coding-assistant");
    });

    it("maps sandbox_mode 'full' to 'all'", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        sandboxMode: "full",
      }));
      expect(payload.sandbox_mode).toBe("all");
    });

    it("maps sandbox_mode 'partial' to 'non-main'", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        sandboxMode: "partial",
      }));
      expect(payload.sandbox_mode).toBe("non-main");
    });

    it("maps sandbox_mode 'none' to 'off'", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        sandboxMode: "none",
      }));
      expect(payload.sandbox_mode).toBe("off");
    });
  });

  describe("advanced mode", () => {
    it("includes advanced fields in advanced mode for custom agent", () => {
      const payload = constructConfigPayload(createDefaultInput({
        mode: "advanced",
        heartbeatMode: "idle",
        idleTimeoutMs: 7200000,
        memoryEnabled: true,
        memoryMd: "# Memory Config",
      }));

      expect(payload.heartbeat_mode).toBe("idle");
      expect(payload.idle_timeout_ms).toBe(7200000);
      expect(payload.memory_enabled).toBe(true);
      expect(payload.memory_md).toBe("# Memory Config");
    });

    it("only sets idle_timeout_ms when heartbeat_mode is idle", () => {
      const idlePayload = constructConfigPayload(createDefaultInput({
        mode: "advanced",
        heartbeatMode: "idle",
        idleTimeoutMs: 7200000,
      }));
      expect(idlePayload.idle_timeout_ms).toBe(7200000);

      const hourlyPayload = constructConfigPayload(createDefaultInput({
        mode: "advanced",
        heartbeatMode: "1h",
        idleTimeoutMs: 7200000,
      }));
      expect(hourlyPayload.idle_timeout_ms).toBeNull();
    });
  });

  describe("fallback models", () => {
    it("includes fallback models when enabled", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        enableFallbacks: true,
        fallbackModels: ["openai/gpt-5.4", "google/gemini-3.1-pro-preview"],
      }));

      expect(payload.fallback_models).toEqual(["openai/gpt-5.4", "google/gemini-3.1-pro-preview"]);
    });

    it("returns null when fallbacks are disabled", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        enableFallbacks: false,
        fallbackModels: ["openai/gpt-5.4"],
      }));

      expect(payload.fallback_models).toBeNull();
    });

    it("filters out empty fallback model strings", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        enableFallbacks: true,
        fallbackModels: ["openai/gpt-5.4", "", "google/gemini-3.1-pro-preview"],
      }));

      expect(payload.fallback_models).toEqual(["openai/gpt-5.4", "google/gemini-3.1-pro-preview"]);
    });
  });

  describe("provider auth", () => {
    it("uses provider auth token over apiKey", () => {
      const payload = constructConfigPayload(createDefaultInput({
        apiKey: "raw-key",
        providerAuths: {
          anthropic: { auth_method: "token", token: "auth-token", profile_key: null, profile: null, oauth_provider_id: null },
        },
      }));

      expect(payload.api_key).toBe("auth-token");
    });

    it("falls back to apiKey when no provider auth exists", () => {
      const payload = constructConfigPayload(createDefaultInput({
        apiKey: "raw-key",
        providerAuths: {},
      }));

      expect(payload.api_key).toBe("raw-key");
    });

    it("respects providerAuthsOverride parameter", () => {
      const override: Record<string, ProviderAuthConfig> = {
        anthropic: { auth_method: "oauth", token: "override-token", profile_key: "anthropic:default", profile: null, oauth_provider_id: null },
      };

      const payload = constructConfigPayload(
        createDefaultInput({ apiKey: "original" }),
        override,
      );

      expect(payload.api_key).toBe("override-token");
      expect(payload.auth_method).toBe("oauth");
      expect(payload.provider_auths).toBe(override);
    });
  });

  describe("messaging channels", () => {
    it("sets telegram_token for telegram channel", () => {
      const payload = constructConfigPayload(createDefaultInput({
        messagingChannel: "telegram",
        telegramToken: "123:ABC",
      }));

      expect(payload.telegram_token).toBe("123:ABC");
      expect(payload.whatsapp_enabled).toBe(false);
      expect(payload.whatsapp_dm_policy).toBeNull();
    });

    it("sets whatsapp fields for whatsapp channel", () => {
      const payload = constructConfigPayload(createDefaultInput({
        messagingChannel: "whatsapp",
        whatsappDmPolicy: "open",
        whatsappPhoneNumber: "+15551234567",
      }));

      expect(payload.whatsapp_enabled).toBe(true);
      expect(payload.whatsapp_dm_policy).toBe("open");
      expect(payload.whatsapp_phone_number).toBe("+15551234567");
    });

    it("nullifies whatsapp fields when channel is not whatsapp", () => {
      const payload = constructConfigPayload(createDefaultInput({
        messagingChannel: "none",
        whatsappDmPolicy: "open",
        whatsappPhoneNumber: "+15551234567",
      }));

      expect(payload.whatsapp_enabled).toBe(false);
      expect(payload.whatsapp_dm_policy).toBeNull();
      expect(payload.whatsapp_phone_number).toBeNull();
    });
  });

  describe("local model providers", () => {
    it("sets local_base_url for local provider", () => {
      const payload = constructConfigPayload(createDefaultInput({
        provider: "local",
        localBaseUrl: "http://localhost:8080",
      }));
      expect(payload.local_base_url).toBe("http://localhost:8080");
    });

    it("sets lmstudio base url for lmstudio provider", () => {
      const payload = constructConfigPayload(createDefaultInput({
        provider: "lmstudio",
        lmstudioBaseUrl: "http://localhost:1234",
      }));
      expect(payload.local_base_url).toBe("http://localhost:1234");
    });

    it("sets local_base_url to null for cloud providers", () => {
      const payload = constructConfigPayload(createDefaultInput({
        provider: "anthropic",
      }));
      expect(payload.local_base_url).toBeNull();
    });
  });

  describe("thinking level", () => {
    it("includes thinking_level for Claude 4 models", () => {
      const payload = constructConfigPayload(createDefaultInput({
        provider: "anthropic",
        model: "anthropic/claude-opus-4-6",
        thinkingLevel: "high",
      }));
      expect(payload.thinking_level).toBe("high");
    });

    it("nullifies thinking_level for non-Anthropic providers", () => {
      const payload = constructConfigPayload(createDefaultInput({
        provider: "openai",
        model: "openai/gpt-5.4",
        thinkingLevel: "high",
      }));
      expect(payload.thinking_level).toBeNull();
    });

    it("nullifies thinking_level for non-Claude-4 models", () => {
      const payload = constructConfigPayload(createDefaultInput({
        provider: "anthropic",
        model: "anthropic/claude-3-haiku",
        thinkingLevel: "high",
      }));
      expect(payload.thinking_level).toBeNull();
    });
  });

  describe("multi-agent configuration", () => {
    const mockAgentConfig: AgentConfigData = {
      id: "agent-1",
      name: "Sub Agent",
      model: "anthropic/claude-sonnet-4-6",
      fallbackModels: [],
      skills: ["filesystem"],
      vibe: "helpful",
      emoji: "🤖",
      identityMd: "# Sub Agent Identity",
      userMd: "",
      soulMd: "",
      toolsMd: "",
      agentsMd: "",
      toolPolicy: { ...DEFAULT_TOOL_POLICY, inherit: true },
      cronJobs: [],
    };

    it("includes agents array when multi-agent is enabled", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        enableMultiAgent: true,
        agentConfigs: [mockAgentConfig],
      }));

      expect(payload.agents).not.toBeNull();
      expect(payload.agents).toHaveLength(1);
      expect(payload.agents![0].id).toBe("agent-1");
      expect(payload.agents![0].name).toBe("Sub Agent");
      expect(payload.agents![0].vibe).toBe("helpful");
    });

    it("generates default identity_md for agents without one", () => {
      const agentNoIdentity = { ...mockAgentConfig, identityMd: "" };
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        enableMultiAgent: true,
        agentConfigs: [agentNoIdentity],
      }));

      expect(payload.agents![0].identity_md).toContain("Sub Agent");
      expect(payload.agents![0].identity_md).toContain("🤖");
    });

    it("uses default emoji when agent has no emoji", () => {
      const agentNoEmoji = { ...mockAgentConfig, identityMd: "", emoji: "" };
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        enableMultiAgent: true,
        agentConfigs: [agentNoEmoji],
      }));

      expect(payload.agents![0].identity_md).toContain("🦞");
    });

    it("sets agents null when multi-agent is disabled", () => {
      const payload = constructConfigPayload(createDefaultInput({
        enableMultiAgent: false,
        agentConfigs: [mockAgentConfig],
      }));

      expect(payload.agents).toBeNull();
    });

    it("nullifies agent fallback_models when empty", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        enableMultiAgent: true,
        agentConfigs: [mockAgentConfig],
      }));

      expect(payload.agents![0].fallback_models).toBeNull();
    });

    it("includes agent fallback_models when present", () => {
      const agentWithFallbacks = { ...mockAgentConfig, fallbackModels: ["openai/gpt-5.4"] };
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        enableMultiAgent: true,
        agentConfigs: [agentWithFallbacks],
      }));

      expect(payload.agents![0].fallback_models).toEqual(["openai/gpt-5.4"]);
    });
  });

  describe("cron jobs", () => {
    it("includes cron_jobs when present", () => {
      const cronJobs = [{ name: "daily-report", schedule: "0 9 * * *", command: "generate report" }];
      const payload = constructConfigPayload(createDefaultInput({ cronJobs }));
      expect(payload.cron_jobs).toEqual(cronJobs);
    });

    it("nullifies cron_jobs when empty", () => {
      const payload = constructConfigPayload(createDefaultInput({ cronJobs: [] }));
      expect(payload.cron_jobs).toBeNull();
    });
  });

  describe("tool policy", () => {
    it("sets tools_mode to 'all' when full profile with no allow/deny", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        toolPolicy: { profile: "full", allow: [], deny: [], elevatedEnabled: false },
      }));
      expect(payload.tools_mode).toBe("all");
    });

    it("sets tools_mode to 'allowlist' when profile is not full", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        toolPolicy: { profile: "coding", allow: [], deny: [], elevatedEnabled: false },
      }));
      expect(payload.tools_mode).toBe("allowlist");
    });

    it("sets tools_mode to 'allowlist' when full profile has deny list", () => {
      const payload = constructConfigPayload(createDefaultInput({
        agentType: "coding-assistant",
        toolPolicy: { profile: "full", allow: [], deny: ["exec"], elevatedEnabled: false },
      }));
      expect(payload.tools_mode).toBe("allowlist");
    });
  });
});
