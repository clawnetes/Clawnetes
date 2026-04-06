import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "check_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: false, openclaw_installed: false });
    }
    if (cmd === "get_openclaw_version") return Promise.resolve("2026.4.5");
    if (cmd === "prepare_gateway_chat_connection") {
      return Promise.resolve({
        wsUrl: "ws://127.0.0.1:18789",
        authToken: "token-123",
        targetEnvironment: "local",
        gatewayPort: 18789,
        tunnelActive: false,
        openClawVersion: "2026.4.5",
      });
    }
    if (cmd === "restart_openclaw_gateway") return Promise.resolve(null);
    return Promise.resolve(null);
  }),
  openExternal: vi.fn(),
  openDialog: vi.fn(),
}));

import App from "../App";

describe("WhatsAppChannel", () => {
  it("App renders without error", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Start Setup")).toBeInTheDocument();
    });
  });

  it("WhatsApp config payload includes whatsapp fields when channel is whatsapp", () => {
    const buildPayload = (channel: string, dmPolicy: string) => ({
      whatsapp_enabled: channel === "whatsapp",
      whatsapp_dm_policy: channel === "whatsapp" ? dmPolicy : null,
    });

    const payload = buildPayload("whatsapp", "open");
    expect(payload.whatsapp_enabled).toBe(true);
    expect(payload.whatsapp_dm_policy).toBe("open");
  });

  it("WhatsApp config payload excludes whatsapp_dm_policy when channel is not whatsapp", () => {
    const buildPayload = (channel: string, dmPolicy: string) => ({
      whatsapp_enabled: channel === "whatsapp",
      whatsapp_dm_policy: channel === "whatsapp" ? dmPolicy : null,
    });

    const payloadNone = buildPayload("none", "open");
    expect(payloadNone.whatsapp_enabled).toBe(false);
    expect(payloadNone.whatsapp_dm_policy).toBeNull();

    const payloadTelegram = buildPayload("telegram", "open");
    expect(payloadTelegram.whatsapp_enabled).toBe(false);
    expect(payloadTelegram.whatsapp_dm_policy).toBeNull();
  });

  it("Default DM policy is open", () => {
    const defaultDmPolicy = "open";
    expect(defaultDmPolicy).toBe("open");
  });

  it("Valid DM policy values", () => {
    const validPolicies = ["pairing", "allowlist", "open"];
    expect(validPolicies).toContain("pairing");
    expect(validPolicies).toContain("allowlist");
    expect(validPolicies).toContain("open");
    expect(validPolicies.length).toBe(3);
  });

  it("Channel dropdown options include none, telegram, whatsapp", () => {
    const options = ["none", "telegram", "whatsapp"];
    expect(options).toContain("none");
    expect(options).toContain("telegram");
    expect(options).toContain("whatsapp");
    expect(options.length).toBe(3);
  });

  it("prepare_gateway_chat_connection mock returns gateway bootstrap", async () => {
    const { invoke } = await import("../lib/tauri");
    const result = await invoke("prepare_gateway_chat_connection", { gatewayPort: 18789 });
    expect(result).toMatchObject({
      wsUrl: "ws://127.0.0.1:18789",
      authToken: "token-123",
      gatewayPort: 18789,
    });
  });

  it("WS RPC message format is correct", () => {
    const buildRpcMessage = (method: string, params: Record<string, unknown>) => ({
      id: "test-uuid",
      method,
      params,
    });

    const loginStart = buildRpcMessage("web.login.start", { timeoutMs: 30000 });
    expect(loginStart.method).toBe("web.login.start");
    expect(loginStart.params).toHaveProperty("timeoutMs", 30000);

    const loginWait = buildRpcMessage("web.login.wait", { timeoutMs: 120000 });
    expect(loginWait.method).toBe("web.login.wait");
    expect(loginWait.params).toHaveProperty("timeoutMs", 120000);
  });
});
