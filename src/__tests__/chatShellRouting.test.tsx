import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

function createReconnectMockWebSocket() {
  let sessionId = "sess-1";
  let transcript = [
    {
      role: "assistant",
      content: [{ type: "text", text: "Welcome back." }],
      timestamp: Date.now(),
    },
  ];
  let runCounter = 0;

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
                  sessionId,
                  updatedAt: Date.now(),
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
              sessionId,
              messages: transcript,
            },
          });
          break;
        case "chat.send":
          runCounter += 1;
          respond({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { runId: `run-${runCounter}`, status: "started" },
          });
          if (parsed.params.message === "/new") {
            sessionId = `sess-${runCounter + 1}`;
            transcript = [
              {
                role: "assistant",
                content: [{ type: "text", text: "Fresh start." }],
                timestamp: Date.now(),
              },
            ];
            queueMicrotask(() => {
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "agent",
                  payload: { runId: `run-${runCounter}`, stream: "assistant", data: { text: "Fresh start." } },
                }),
              });
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "chat",
                  payload: { sessionKey: "main", runId: `run-${runCounter}`, state: "final" },
                }),
              });
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "sessions.changed",
                  payload: { sessionKey: "main", sessionId, updatedAt: Date.now(), reason: "reset" },
                }),
              });
            });
          }
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

  return MockWebSocket;
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
    localStorage.clear();
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket());
    let uuidCounter = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++uuidCounter}` });
    vi.stubGlobal("navigator", {
      platform: "test-platform",
      userAgent: "vitest",
      language: "en-GB",
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: window.localStorage,
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

    expect(screen.getByTestId("window-titlebar")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("Main Agent").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
  });

  it("keeps the fresh conversation selected after reconnect", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByTestId("chat-new-session"));

    await waitFor(() => {
      expect(screen.getAllByText("Fresh start.").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByTestId("chat-reconnect"));

    await waitFor(() => {
      expect(screen.getAllByText("Fresh start.").length).toBeGreaterThan(0);
    });
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
