import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

type MockSession = {
  agentId: string;
  key: string;
  sessionId: string;
  displayName: string;
  derivedTitle: string;
  messages: Array<Record<string, unknown>>;
};

function createReconnectMockWebSocket(options?: {
  historyMessages?: Array<Record<string, unknown>>;
  sessions?: MockSession[];
  onChatSend?: (sessionKey: string) => void;
}) {
  const initialSessions = options?.sessions || [
    {
      agentId: "main",
      key: "main",
      sessionId: "sess-1",
      displayName: "Main Session",
      derivedTitle: "Main Session",
      messages: options?.historyMessages || [
        {
          role: "assistant",
          content: [{ type: "text", text: "Welcome back." }],
          timestamp: Date.now(),
        },
      ],
    },
  ];
  const sessions = new Map(
    initialSessions.map((session) => [session.key, { ...session, messages: session.messages.map((message) => ({ ...message })) }]),
  );
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
          {
            const requestedAgentId = parsed.params?.agentId || "main";
            const visibleSessions = [...sessions.values()].filter((session) =>
              session.agentId === requestedAgentId || (parsed.params?.includeGlobal && session.agentId === "main"),
            );
            respond({
              type: "res",
              id: parsed.id,
              ok: true,
              payload: {
                sessions: visibleSessions.map((session) => ({
                  key: session.key,
                  displayName: session.displayName,
                  derivedTitle: session.derivedTitle,
                  sessionId: session.sessionId,
                  updatedAt: Date.now(),
                })),
              },
            });
          }
          break;
        case "chat.history":
          {
            const session = sessions.get(parsed.params.sessionKey);
            respond({
              type: "res",
              id: parsed.id,
              ok: true,
              payload: {
                sessionKey: parsed.params.sessionKey,
                sessionId: session?.sessionId || null,
                messages: session?.messages || [],
              },
            });
          }
          break;
        case "chat.send":
          options?.onChatSend?.(parsed.params.sessionKey);
          runCounter += 1;
          respond({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { runId: `run-${runCounter}`, status: "started" },
          });
          if (parsed.params.message === "/new") {
            const mainSession = sessions.get("main");
            if (!mainSession) break;
            mainSession.sessionId = `sess-${runCounter + 1}`;
            mainSession.messages = [
              {
                role: "assistant",
                content: [{ type: "text", text: "Fresh start." }],
                timestamp: Date.now(),
              },
            ];
            sessions.set("main", mainSession);
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
                  payload: { sessionKey: "main", sessionId: mainSession.sessionId, updatedAt: Date.now(), reason: "reset" },
                }),
              });
            });
          } else {
            const session = sessions.get(parsed.params.sessionKey);
            if (!session) break;
            const replyText = parsed.params.sessionKey === "ops" ? "Ops Agent handled it." : "Main Agent handled it.";
            session.messages = [
              ...session.messages,
              { role: "user", text: parsed.params.message, timestamp: Date.now() },
              { role: "assistant", content: [{ type: "text", text: replyText }], timestamp: Date.now() + 1 },
            ];
            sessions.set(parsed.params.sessionKey, session);
            queueMicrotask(() => {
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "agent",
                  payload: { runId: `run-${runCounter}`, stream: "assistant", data: { text: replyText } },
                }),
              });
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "chat",
                  payload: { sessionKey: parsed.params.sessionKey, runId: `run-${runCounter}`, state: "final" },
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

function setupRemoteInstalledInvokeMock() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "check_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: true, openclaw_installed: false });
    }
    if (cmd === "get_openclaw_version") {
      return Promise.resolve("2.0.0");
    }
    if (cmd === "has_saved_license") {
      return Promise.resolve(false);
    }
    if (cmd === "test_ssh_connection") {
      return Promise.resolve(true);
    }
    if (cmd === "check_remote_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: true, openclaw_installed: true });
    }
    if (cmd === "get_remote_openclaw_version") {
      return Promise.resolve("2.0.0");
    }
    if (cmd === "prepare_gateway_chat_connection") {
      return Promise.resolve({
        wsUrl: "ws://127.0.0.1:28789",
        authToken: "token-123",
        targetEnvironment: "cloud",
        gatewayPort: 28789,
        tunnelActive: true,
        openClawVersion: "2.0.0",
      });
    }
    return Promise.resolve(null);
  });
}

async function openInstalledLocalChat(user: ReturnType<typeof userEvent.setup> = userEvent.setup()) {
  render(<App />);

  await waitFor(() => {
    expect(screen.getByTestId("step-environment")).toBeInTheDocument();
  });

  await user.click(screen.getByTestId("btn-continue"));

  await waitFor(() => {
    expect(screen.getByText("Agent Workspace")).toBeInTheDocument();
  });

  return user;
}

async function openRemoteInstalledChat(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);

  await waitFor(() => {
    expect(screen.getByText("Start Setup")).toBeInTheDocument();
  });

  await user.click(screen.getByText("Start Setup"));
  await waitFor(() => {
    expect(screen.getByTestId("step-environment")).toBeInTheDocument();
  });

  await user.click(screen.getByText(/Cloud Server/i));
  await user.type(screen.getByTestId("input-remote-ip"), "10.0.0.8");
  await user.type(screen.getByTestId("input-remote-user"), "ubuntu");
  await user.click(screen.getByTestId("btn-test-connection"));

  await waitFor(() => {
    expect(screen.getByText(/SSH connection established successfully!/i)).toBeInTheDocument();
  });

  await user.click(screen.getByTestId("btn-continue"));

  await waitFor(() => {
    expect(screen.getByText("Agent Workspace")).toBeInTheDocument();
  });
}

describe("Installed-state chat shell", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
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

  it("shows Target Environment on startup when local OpenClaw is already installed", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("step-environment")).toBeInTheDocument();
    });

    expect(screen.queryByText("Agent Workspace")).not.toBeInTheDocument();
  });

  it("opens the native chat workspace after the local environment is confirmed", async () => {
    await openInstalledLocalChat();

    await waitFor(() => {
      expect(screen.getAllByText("Main Agent").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
  });

  it("keeps the fresh conversation selected after reconnect", async () => {
    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    await user.click(screen.getByTestId("chat-new-session"));

    await waitFor(() => {
      expect(screen.getAllByText("Fresh start.").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByTestId("chat-reconnect"));

    await waitFor(() => {
      expect(screen.getAllByText("Fresh start.").length).toBeGreaterThan(0);
    });
  });

  it("opens the Command Center as a separate screen and returns to chat", async () => {
    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    await user.click(screen.getByRole("button", { name: "Configure" }));

    await waitFor(() => {
      expect(screen.getByTestId("command-center-screen")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "← Back to app" }));

    await waitFor(() => {
      expect(screen.getByText("Agent Workspace")).toBeInTheDocument();
    });
  });

  it("keeps internal weather transcript noise hidden after returning from Command Center", async () => {
    const noisyTranscript = [
      {
        role: "assistant",
        content: [{
          type: "text",
          text: `Weather report for: london
[38;5;226m     .-.     [0m +10 C
Timezone: Europe/London
TEST
Tomorrow looks clear and cool.`,
        }],
        timestamp: Date.now(),
      },
    ];
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket({ historyMessages: noisyTranscript }));

    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    expect(screen.queryByText(/Weather report for:/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Configure" }));

    await waitFor(() => {
      expect(screen.getByTestId("command-center-screen")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "← Back to app" }));

    await waitFor(() => {
      expect(screen.getAllByText("Tomorrow looks clear and cool.").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/Weather report for:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Timezone: Europe\/London/i)).not.toBeInTheDocument();
  });

  it("routes chat sends to the selected sub-agent session instead of main", async () => {
    const sentSessionKeys: string[] = [];
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket({
      sessions: [
        {
          agentId: "main",
          key: "main",
          sessionId: "sess-1",
          displayName: "Main Session",
          derivedTitle: "Main Session",
          messages: [{ role: "assistant", content: [{ type: "text", text: "Welcome back." }], timestamp: Date.now() }],
        },
        {
          agentId: "ops",
          key: "ops",
          sessionId: "sess-ops",
          displayName: "Ops Session",
          derivedTitle: "Ops Session",
          messages: [{ role: "assistant", content: [{ type: "text", text: "Ops ready." }], timestamp: Date.now() }],
        },
      ],
      onChatSend: (sessionKey) => sentSessionKeys.push(sessionKey),
    }));

    await openInstalledLocalChat(user);

    await user.selectOptions(screen.getByTestId("chat-active-agent"), "ops");

    await waitFor(() => {
      expect(screen.getAllByText("Ops ready.").length).toBeGreaterThan(0);
    });

    await user.type(screen.getByTestId("chat-composer"), "Handle this");
    await user.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(screen.getAllByText("Ops Agent handled it.").length).toBeGreaterThan(0);
    });

    expect(sentSessionKeys[sentSessionKeys.length - 1]).toBe("ops");
  });

  it("keeps the dark startup theme when remote chat opens without a saved preference", async () => {
    const user = userEvent.setup();
    setupRemoteInstalledInvokeMock();

    expect(document.documentElement.dataset.theme).toBeUndefined();

    await openRemoteInstalledChat(user);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
    expect(localStorage.getItem("clawnetes.chat.theme.v1")).toBe("dark");
  });

  it("uses an explicit light preference when remote chat opens", async () => {
    const user = userEvent.setup();
    localStorage.setItem("clawnetes.chat.theme.v1", "light");
    setupRemoteInstalledInvokeMock();

    await openRemoteInstalledChat(user);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
    });
    expect(localStorage.getItem("clawnetes.chat.theme.v1")).toBe("light");
  });
});
