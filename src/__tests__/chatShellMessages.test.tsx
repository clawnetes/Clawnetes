import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

type MockSessionState = {
  sessionId: string;
  displayName: string;
  derivedTitle: string;
  updatedAt: number;
  messages: Array<Record<string, unknown>>;
};

function createMockWebSocket(options?: {
  historyMessages?: unknown[];
  sessions?: MockSessionState[];
  sendErrorMessage?: string;
}) {
  const sentMethods: string[] = [];
  const sessions = new Map<string, MockSessionState>();
  const initialSessions =
    options?.sessions ||
    [
      {
        sessionId: "sess-live-1",
        displayName: "Main Session",
        derivedTitle: "Main Session",
        updatedAt: 10,
        messages: (options?.historyMessages as Array<Record<string, unknown>>) || [],
      },
    ];

  for (const session of initialSessions) {
    sessions.set("main", {
      ...session,
      messages: session.messages.map((message) => ({ ...message })),
    });
  }

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
      sentMethods.push(parsed.method);
      const respond = (payload: unknown) => {
        this.emit("message", { data: JSON.stringify(payload) });
      };

      switch (parsed.method) {
        case "connect":
          respond({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { protocol: 3, auth: { role: "operator", scopes: ["operator.admin"], deviceToken: "dt" } },
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
                { id: "main", name: "Atlas" },
                { id: "ops", name: "Ops Agent" },
              ],
            },
          });
          break;
        case "sessions.list": {
          const main = sessions.get("main");
          respond({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: {
              sessions: main
                ? [
                    {
                      key: "main",
                      displayName: main.displayName,
                      derivedTitle: main.derivedTitle,
                      sessionId: main.sessionId,
                      updatedAt: main.updatedAt,
                      lastMessagePreview:
                        typeof main.messages[main.messages.length - 1]?.text === "string"
                          ? String(main.messages[main.messages.length - 1]?.text)
                          : undefined,
                    },
                  ]
                : [],
            },
          });
          break;
        }
        case "chat.history": {
          const main = sessions.get(parsed.params.sessionKey);
          respond({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: {
              sessionKey: parsed.params.sessionKey,
              sessionId: main?.sessionId || null,
              messages: main?.messages || [],
            },
          });
          break;
        }
        case "chat.send": {
          if (options?.sendErrorMessage) {
            respond({
              type: "res",
              id: parsed.id,
              ok: false,
              error: { code: "CHAT_SEND_FAILED", message: options.sendErrorMessage },
            });
            break;
          }

          runCounter += 1;
          const runId = `run-${runCounter}`;
          const main = sessions.get(parsed.params.sessionKey) || {
            sessionId: "sess-live-1",
            displayName: "Main Session",
            derivedTitle: "Main Session",
            updatedAt: 10,
            messages: [],
          };

          respond({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { runId, status: "started" },
          });

          if (parsed.params.message === "/new") {
            main.sessionId = `sess-live-${runCounter + 1}`;
            main.updatedAt += 1;
            main.messages = [
              { role: "assistant", content: [{ type: "text", text: "Fresh start." }], timestamp: Date.now() },
            ];
            sessions.set("main", main);
            queueMicrotask(() => {
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "agent",
                  payload: { runId, stream: "assistant", data: { text: "Fresh start." } },
                }),
              });
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "chat",
                  payload: { sessionKey: "main", runId, state: "final" },
                }),
              });
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "sessions.changed",
                  payload: { sessionKey: "main", sessionId: main.sessionId, updatedAt: main.updatedAt, reason: "reset" },
                }),
              });
            });
          } else {
            main.messages = [
              ...main.messages,
              { role: "user", text: parsed.params.message, timestamp: Date.now() },
              { role: "assistant", content: [{ type: "text", text: "Done." }], timestamp: Date.now() + 1 },
            ];
            sessions.set("main", main);
            queueMicrotask(() => {
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "agent",
                  payload: { runId, stream: "assistant", data: { text: "Done." } },
                }),
              });
              this.emit("message", {
                data: JSON.stringify({
                  type: "event",
                  event: "chat",
                  payload: { sessionKey: "main", runId, state: "final" },
                }),
              });
            });
          }
          break;
        }
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

  return { WebSocket: MockWebSocket, sentMethods };
}

vi.mock("../lib/tauri", () => ({
  invoke: invokeMock,
  openExternal: vi.fn(),
  openDialog: vi.fn(),
}));

import App from "../App";

function setupInvokeMock() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "check_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: true, openclaw_installed: true });
    }
    if (cmd === "get_openclaw_version") return Promise.resolve("2.0.0");
    if (cmd === "has_saved_license") return Promise.resolve(false);
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
    if (cmd === "run_doctor_repair") return Promise.resolve("repair-ok");
    return Promise.resolve(null);
  });
}

describe("ChatShell message display", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
    let uuidCounter = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++uuidCounter}` });
    vi.stubGlobal("navigator", { platform: "test", userAgent: "vitest", language: "en-GB" });
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
    setupInvokeMock();
  });

  it("shows 'You' for user messages and agent name for assistant messages", async () => {
    const { WebSocket } = createMockWebSocket({
      historyMessages: [
        { role: "user", content: [{ type: "input_text", text: "Hello agent" }], timestamp: 1 },
        { role: "assistant", content: [{ type: "text", text: "Hi there!" }], timestamp: 2 },
      ],
    });
    vi.stubGlobal("WebSocket", WebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("You")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Atlas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hello agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hi there!").length).toBeGreaterThan(0);
    expect(screen.queryByText("user")).not.toBeInTheDocument();
  });

  it("filters out tool messages from the transcript", async () => {
    const { WebSocket } = createMockWebSocket({
      historyMessages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "read", input: {} }], timestamp: 1 },
        { role: "assistant", content: [{ type: "text", text: "Here is the answer." }], timestamp: 2 },
      ],
    });
    vi.stubGlobal("WebSocket", WebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("Here is the answer.").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText("read")).not.toBeInTheDocument();
  });

  it("filters out routine system messages from loaded history", async () => {
    const { WebSocket } = createMockWebSocket({
      historyMessages: [
        { role: "system", content: [{ type: "text", text: "Internal system notice" }], timestamp: 1 },
        { role: "assistant", content: [{ type: "text", text: "Visible answer." }], timestamp: 2 },
      ],
    });
    vi.stubGlobal("WebSocket", WebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("Visible answer.").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText("Internal system notice")).not.toBeInTheDocument();
  });

  it("shows send failures as visible system errors", async () => {
    const { WebSocket } = createMockWebSocket({ sendErrorMessage: "Request failed." });
    vi.stubGlobal("WebSocket", WebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-composer")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "Hello" } });
    expect(screen.getByTestId("chat-send")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(screen.getByText(/Request failed\./)).toBeInTheDocument();
    });

    expect(screen.getByText("System")).toBeInTheDocument();
  });
});

describe("ChatShell fresh chat flow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
    let uuidCounter = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++uuidCounter}` });
    vi.stubGlobal("navigator", { platform: "test", userAgent: "vitest", language: "en-GB" });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: true,
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
    setupInvokeMock();
  });

  it("uses /new via chat.send and never calls sessions.create", async () => {
    const user = userEvent.setup();
    const { WebSocket, sentMethods } = createMockWebSocket({
      historyMessages: [
        { role: "assistant", content: [{ type: "text", text: "Older transcript" }], timestamp: 2 },
      ],
    });
    vi.stubGlobal("WebSocket", WebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("Older transcript").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByTestId("chat-new-session"));

    await waitFor(() => {
      expect(screen.getAllByText("Fresh start.").length).toBeGreaterThan(0);
    });

    expect(sentMethods).toContain("chat.send");
    expect(sentMethods).not.toContain("sessions.create");

    const archivedThread = screen
      .getAllByRole("button")
      .find((button) => typeof button.className === "string" && button.className.includes("chat-list-item archived"));
    expect(archivedThread).toBeDefined();

    await user.click(archivedThread!);

    await waitFor(() => {
      expect(screen.getAllByText("Older transcript").length).toBeGreaterThan(0);
    });
  });

  it("persists theme selection", async () => {
    const user = userEvent.setup();
    const { WebSocket } = createMockWebSocket();
    vi.stubGlobal("WebSocket", WebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Workspace")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "light" }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("clawnetes.chat.theme.v1")).toBe("light");
  });

  it("renders compact thread rows without sidebar preview text", async () => {
    const user = userEvent.setup();
    const { WebSocket } = createMockWebSocket({
      historyMessages: [{ role: "assistant", content: [{ type: "text", text: "Older transcript" }], timestamp: 2 }],
    });
    vi.stubGlobal("WebSocket", WebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("Older transcript").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByTestId("chat-new-session"));

    await waitFor(() => {
      expect(screen.getAllByText("Fresh start.").length).toBeGreaterThan(0);
    });

    const threadButtons = screen
      .getAllByRole("button")
      .filter((button) => typeof button.className === "string" && button.className.includes("chat-list-item"));
    expect(threadButtons.length).toBeGreaterThan(0);
    expect(threadButtons.some((button) => button.textContent?.includes("Fresh conversation"))).toBe(false);
  });
});
