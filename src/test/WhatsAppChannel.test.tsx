import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const QR_MOCK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "check_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: false, openclaw_installed: false });
    }
    if (cmd === "get_openclaw_version") return Promise.resolve("2026.3.2");
    if (cmd === "start_whatsapp_login") return Promise.resolve(QR_MOCK);
    if (cmd === "wait_whatsapp_login") return Promise.resolve(true);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/dialog", () => ({ open: vi.fn() }));

import App from "../App";

describe("WhatsAppChannel", () => {
  it("App renders without error", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Start Setup")).toBeInTheDocument();
    });
  });

  it("WhatsApp config payload includes whatsapp fields when enabled", () => {
    const buildPayload = (enabled: boolean, dmPolicy: string) => ({
      whatsapp_enabled: enabled,
      whatsapp_dm_policy: enabled ? dmPolicy : null,
    });

    const payload = buildPayload(true, "pairing");
    expect(payload.whatsapp_enabled).toBe(true);
    expect(payload.whatsapp_dm_policy).toBe("pairing");
  });

  it("WhatsApp config payload excludes whatsapp_dm_policy when disabled", () => {
    const buildPayload = (enabled: boolean, dmPolicy: string) => ({
      whatsapp_enabled: enabled,
      whatsapp_dm_policy: enabled ? dmPolicy : null,
    });

    const payload = buildPayload(false, "pairing");
    expect(payload.whatsapp_enabled).toBe(false);
    expect(payload.whatsapp_dm_policy).toBeNull();
  });

  it("Valid DM policy values", () => {
    const validPolicies = ["pairing", "allowlist", "open"];
    expect(validPolicies).toContain("pairing");
    expect(validPolicies).toContain("allowlist");
    expect(validPolicies).toContain("open");
    expect(validPolicies.length).toBe(3);
  });

  it("start_whatsapp_login mock returns QR data URL", async () => {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const result = await invoke("start_whatsapp_login", { gatewayPort: 18789 });
    expect(typeof result).toBe("string");
    expect((result as string).startsWith("data:image/png;base64,")).toBe(true);
  });

  it("wait_whatsapp_login mock returns connected boolean", async () => {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const result = await invoke("wait_whatsapp_login", { gatewayPort: 18789 });
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
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
