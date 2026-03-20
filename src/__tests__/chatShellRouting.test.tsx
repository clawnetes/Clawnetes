import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  private listeners = new Map<string, Array<(event?: any) => void>>();

  constructor(_url: string) {
    queueMicrotask(() => {
      this.emit("open");
      this.emit("message", {
        data: JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "nonce-123" },
        }),
      });
    });
  }

  addEventListener(type: string, handler: (event?: any) => void) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  send(raw: string) {
    const parsed = JSON.parse(raw);
    const respond = (payload: unknown) => {
      this.emit("message", { data: JSON.stringify(payload) });
    };

    switch (parsed.method) {
      case "connect":
        respond({
          type: "res",
          id: parsed.id,
          ok: true,
          payload: { protocol: 3, auth: { role: "operator", scopes: ["operator.admin"], deviceToken: "device-token" } },
        });
        break;
      case "agents.list":
        respond({
          type: "res",
          id: parsed.id,
          ok: true,
          payload: {
            defaultId: "main",
            agents: [
              { id: "main", name: "Main Agent" },
              { id: "ops", name: "Ops Agent" },
            ],
          },
        });
        break;
      case "sessions.list":
        respond({
          type: "res",
          id: parsed.id,
          ok: true,
          payload: {
            sessions: [
              {
                key: "main",
                displayName: "Main Session",
                derivedTitle: "Main Session",
              },
            ],
          },
        });
        break;
      case "chat.history":
        respond({
          type: "res",
          id: parsed.id,
          ok: true,
          payload: {
            sessionKey: "main",
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "Welcome back." }],
                timestamp: Date.now(),
              },
            ],
          },
        });
        break;
      default:
        respond({ type: "res", id: parsed.id, ok: true, payload: {} });
        break;
    }
  }

  close() {
    this.emit("close");
  }

  private emit(type: string, event?: any) {
    for (const handler of this.listeners.get(type) || []) {
      handler(event);
    }
  }
}

vi.mock("../lib/tauri", () => ({
  invoke: invokeMock,
  openExternal: vi.fn(),
  openDialog: vi.fn(),
}));

import App from "../App";

describe("Installed-state chat shell", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    vi.stubGlobal("navigator", {
      platform: "test-platform",
      userAgent: "vitest",
      language: "en-GB",
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_prerequisites") {
        return Promise.resolve({ node_installed: true, docker_running: true, openclaw_installed: true });
      }
      if (cmd === "get_openclaw_version") {
        return Promise.resolve("2.0.0");
      }
      if (cmd === "has_saved_license") {
        return Promise.resolve(false);
      }
      if (cmd === "prepare_gateway_chat_connection") {
        return Promise.resolve({
          wsUrl: "ws://127.0.0.1:18789",
          authToken: "token-123",
          targetEnvironment: "local",
          gatewayPort: 18789,
          tunnelActive: false,
          openClawVersion: "2.0.0",
        });
      }
      if (cmd === "run_doctor_repair") {
        return Promise.resolve("repair-ok");
      }
      return Promise.resolve(null);
    });
  });

  it("opens the native chat workspace when OpenClaw is already installed", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Workspace")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getAllByText("Main Agent").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Welcome back.")).toBeInTheDocument();
  });

  it("opens the Configure drawer from the chat shell", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Workspace")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Configure" }));

    await waitFor(() => {
      const drawer = screen.getByText("Command Center").closest("aside");
      expect(drawer).toHaveAttribute("aria-hidden", "false");
    });
  });
});
