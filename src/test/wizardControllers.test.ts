import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  invoke: invokeMock,
}));

import { handleInstall, type InstallController } from "../utils/wizardControllers";

function createHermesInstallController(overrides: Partial<InstallController> = {}) {
  const values = {
    loading: false,
    error: false,
    progress: "",
    logs: "",
    step: 21,
    checks: { node: true, docker: false, openclaw: false },
    openClawVersion: "",
    dashboardUrl: "",
  };

  const controller: InstallController = {
    state: {
      platform: "hermes",
      targetEnvironment: "local",
      remoteIp: "",
      remoteUser: "",
      remotePassword: "",
      remotePrivateKeyPath: "",
      checks: values.checks,
      isPaired: false,
      whatsappPaired: false,
      messagingChannel: "none",
      telegramToken: "",
      whatsappDmPolicy: "",
      whatsappPhoneNumber: "",
      gatewayPort: 8642,
      selectedSkills: [],
    },
    configPayloadInput: {
      platform: "hermes",
      provider: "anthropic",
      apiKey: "sk-test",
      authMethod: "token",
      model: "anthropic/claude-opus-4-6",
      userName: "User",
      agentName: "Hermes Agent",
      agentEmoji: "H",
      agentType: "custom",
      telegramToken: "",
      gatewayPort: 8642,
      gatewayBind: "127.0.0.1",
      gatewayAuthMode: "token",
      tailscaleMode: "off",
      nodeManager: "auto",
      selectedSkills: [],
      serviceKeys: {},
      providerAuths: {},
      sandboxMode: "workspace-write",
      toolPolicy: { profile: "minimal", allow: [], deny: [] },
      enableFallbacks: false,
      fallbackModels: [],
      heartbeatMode: "never",
      idleTimeoutMs: 0,
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
      localBaseUrl: "",
      lmstudioBaseUrl: "",
      thinkingLevel: "",
      messagingChannel: "none",
      whatsappDmPolicy: "",
      whatsappPhoneNumber: "",
      mode: "advanced",
    },
    initialConfigRef: { current: null },
    transformInitialToPayload: (initial) => initial,
    normalizeForComparison: (payload) => payload,
    isDeepEqual: () => false,
    setLoading: (value) => { values.loading = value as boolean; },
    setError: (value) => { values.error = value as boolean; },
    setProgress: (value) => { values.progress = value as string; },
    setLogs: (value) => {
      values.logs = typeof value === "function" ? value(values.logs) : value;
    },
    setIsPaired: vi.fn(),
    setWhatsappPaired: vi.fn(),
    setWhatsappPhoneSubmitted: vi.fn(),
    setOpenClawVersion: (value) => { values.openClawVersion = value as string; },
    setChecks: (value) => {
      values.checks = typeof value === "function" ? value(values.checks as any) : value as any;
    },
    setTunnelActive: vi.fn(),
    setPairingCode: vi.fn(),
    setDashboardUrl: (value) => { values.dashboardUrl = value as string; },
    setStep: (value) => { values.step = value as number; },
    ...overrides,
  };

  return { controller, values };
}

describe("handleInstall", () => {
  afterEach(() => {
    vi.useRealTimers();
    invokeMock.mockReset();
  });

  it("does not hang Hermes setup when service restart never resolves", async () => {
    vi.useFakeTimers();

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "install_platform") return Promise.resolve("installed");
      if (cmd === "get_platform_version") return Promise.resolve("Hermes Agent");
      if (cmd === "configure_platform") return Promise.resolve("configured");
      if (cmd === "restart_platform_service") return new Promise(() => {});
      if (cmd === "get_dashboard_url") {
        throw new Error("Hermes setup should not request an OpenClaw dashboard URL");
      }
      return Promise.resolve(null);
    });

    const { controller, values } = createHermesInstallController();
    const installPromise = handleInstall(controller);

    await vi.advanceTimersByTimeAsync(15_000);
    await installPromise;

    expect(values.error).toBe(false);
    expect(values.loading).toBe(false);
    expect(values.step).toBe(17);
    expect(values.dashboardUrl).toBe("http://127.0.0.1:8642/v1");
    expect(values.logs).toContain("Warning: Error: Starting Hermes services timed out after 15 seconds");
  });

  it("does not run OpenClaw-only skill or session commands for Hermes", async () => {
    const calls: string[] = [];
    invokeMock.mockImplementation((cmd: string) => {
      calls.push(cmd);
      if (cmd === "install_platform") return Promise.resolve("installed");
      if (cmd === "get_platform_version") return Promise.resolve("Hermes Agent");
      if (cmd === "configure_platform") return Promise.resolve("configured");
      if (cmd === "restart_platform_service") return Promise.resolve("started");
      if (
        cmd === "install_skill" ||
        cmd === "initialize_agent_sessions" ||
        cmd === "start_gateway" ||
        cmd === "restart_openclaw_gateway" ||
        cmd === "get_dashboard_url" ||
        cmd === "generate_pairing_code" ||
        cmd === "check_messaging_link_status"
      ) {
        throw new Error(`${cmd} should not run for Hermes setup`);
      }
      return Promise.resolve(null);
    });

    const { controller, values } = createHermesInstallController();
    controller.state.selectedSkills = ["filesystem", "terminal"];
    controller.configPayloadInput.selectedSkills = ["filesystem", "terminal"];
    controller.configPayloadInput.enableMultiAgent = true;
    controller.configPayloadInput.agentConfigs = [
      {
        id: "agent-1",
        name: "Hermes Helper",
        model: "anthropic/claude-opus-4-6",
        provider: "anthropic",
        authMethod: "token",
        fallbackModels: [],
        skills: ["filesystem"],
        vibe: "",
        emoji: "H",
        identityMd: "",
        userMd: "",
        soulMd: "",
        toolsMd: "",
        agentsMd: "",
        heartbeatMd: "",
        memoryMd: "",
        heartbeatMode: "never",
        idleTimeoutMs: 0,
        memoryEnabled: false,
        sandboxMode: "workspace-write",
        toolPolicy: { profile: "minimal", allow: [], deny: [] },
        cronJobs: [],
      } as any,
    ];

    await handleInstall(controller);

    expect(values.error).toBe(false);
    expect(values.loading).toBe(false);
    expect(values.step).toBe(17);
    expect(values.dashboardUrl).toBe("http://127.0.0.1:8642/v1");
    expect(calls).not.toContain("install_skill");
    expect(calls).not.toContain("initialize_agent_sessions");
    expect(calls).not.toContain("start_gateway");
    expect(calls).not.toContain("restart_openclaw_gateway");
    expect(calls).not.toContain("get_dashboard_url");
    expect(calls).not.toContain("generate_pairing_code");
    expect(calls).not.toContain("check_messaging_link_status");
  });
});
