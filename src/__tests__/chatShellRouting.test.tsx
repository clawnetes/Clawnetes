import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatShell from "../components/chat/ChatShell";

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
  resolveSessionsForAgent?: (agentId: string, sessions: Map<string, MockSession>) => MockSession[];
  resolveHistoryForSession?: (sessionKey: string, sessions: Map<string, MockSession>) => MockSession | undefined;
}) {
  const initialSessions = options?.sessions || [
    {
      agentId: "main",
      key: "agent:main:main",
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
            const visibleSessions = options?.resolveSessionsForAgent
              ? options.resolveSessionsForAgent(requestedAgentId, sessions)
              : [...sessions.values()].filter((session) =>
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
            const session = options?.resolveHistoryForSession
              ? options.resolveHistoryForSession(parsed.params.sessionKey, sessions)
              : sessions.get(parsed.params.sessionKey);
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
            const mainSession = sessions.get("agent:main:main");
            if (!mainSession) break;
            mainSession.sessionId = `sess-${runCounter + 1}`;
            mainSession.messages = [
              {
                role: "assistant",
                content: [{ type: "text", text: "Fresh start." }],
                timestamp: Date.now(),
              },
            ];
            sessions.set("agent:main:main", mainSession);
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
            const replyText = parsed.params.sessionKey === "agent:ops:main"
              ? "Ops Agent handled it."
              : "Main Agent handled it.";
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
      return Promise.resolve("2026.4.8");
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
      return Promise.resolve("2026.4.8");
    }
    if (cmd === "prepare_gateway_chat_connection") {
      return Promise.resolve({
        wsUrl: "ws://127.0.0.1:28789",
        authToken: "token-123",
        targetEnvironment: "cloud",
        gatewayPort: 28789,
        tunnelActive: true,
        openClawVersion: "2026.4.8",
      });
    }
    return Promise.resolve(null);
  });
}

async function openInstalledLocalChat(user: ReturnType<typeof userEvent.setup> = userEvent.setup()) {
  render(<App />);

  await waitFor(() => {
    expect(screen.getByTestId("step-platform-select")).toBeInTheDocument();
  });

  await user.click(screen.getByTestId("btn-next"));

  await waitFor(() => {
    expect(screen.getByTestId("step-environment")).toBeInTheDocument();
  });

  await user.click(screen.getByTestId("btn-continue"));

  await waitFor(() => {
    expect(screen.getByTestId("chat-sidebar-brand")).toHaveTextContent("Clawnetes");
  });

  return user;
}

async function openSettingsPanel(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "Settings" }));

  // Click the Advanced tab to render the settings panel
  await waitFor(() => {
    expect(screen.getByText("Advanced")).toBeInTheDocument();
  });

  await user.click(screen.getByText("Advanced"));

  await waitFor(() => {
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
  });
}

function mockTranscriptScrollState(initialTop: number, initialHeight = 1600, initialClientHeight = 500) {
  let scrollTop = initialTop;
  let scrollHeight = initialHeight;
  let clientHeight = initialClientHeight;

  Object.defineProperty(HTMLDivElement.prototype, "scrollTop", {
    configurable: true,
    get() {
      return scrollTop;
    },
    set(value: number) {
      scrollTop = value;
    },
  });

  Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return scrollHeight;
    },
  });

  Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return clientHeight;
    },
  });

  return {
    getTop: () => scrollTop,
    setTop: (value: number) => { scrollTop = value; },
    setHeight: (value: number) => { scrollHeight = value; },
    setClientHeight: (value: number) => { clientHeight = value; },
  };
}

const DIRECT_CHAT_BOOTSTRAP = {
  wsUrl: "ws://localhost:3100/ws",
  authToken: "token",
  targetEnvironment: "local",
  gatewayPort: 3333,
  tunnelActive: false,
  openClawVersion: "2026.4.8",
} as const;

async function openRemoteInstalledChat(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);

  await waitFor(() => {
    expect(screen.getByText("Start Setup")).toBeInTheDocument();
  });

  await user.click(screen.getByText("Start Setup"));
  await waitFor(() => {
    expect(screen.getByTestId("step-platform-select")).toBeInTheDocument();
  });

  await user.click(screen.getByTestId("btn-next"));
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
    expect(screen.getByTestId("chat-sidebar-brand")).toHaveTextContent("Clawnetes");
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
        return Promise.resolve("2026.4.8");
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
          openClawVersion: "2026.4.8",
        });
      }
      if (cmd === "run_doctor_repair") {
        return Promise.resolve("repair-ok");
      }
      return Promise.resolve(null);
    });
  });

  it("shows platform selection on startup when local OpenClaw is already installed", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("step-platform-select")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("chat-sidebar-brand")).not.toBeInTheDocument();
  });

  it("opens the native chat workspace after the local environment is confirmed", async () => {
    await openInstalledLocalChat();

    await waitFor(() => {
      expect(screen.getAllByText("Main Agent").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
  });

  it("shows the updated OpenClaw connection label", async () => {
    await openInstalledLocalChat();

    await waitFor(() => {
      expect(screen.getByText("Clawnetes with OpenClaw 2026.4.8")).toBeInTheDocument();
    });
  });

  it("normalizes duplicated OpenClaw text in the footer status label", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_prerequisites") {
        return Promise.resolve({ node_installed: true, docker_running: true, openclaw_installed: true });
      }
      if (cmd === "get_openclaw_version") {
        return Promise.resolve("OpenClaw 2026.4.8 (abe7b2c)");
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
          openClawVersion: "OpenClaw 2026.4.8 (abe7b2c)",
        });
      }
      if (cmd === "run_doctor_repair") {
        return Promise.resolve("repair-ok");
      }
      return Promise.resolve(null);
    });

    await openInstalledLocalChat();

    await waitFor(() => {
      expect(screen.getByText("Clawnetes with OpenClaw 2026.4.8 (abe7b2c)")).toBeInTheDocument();
    });
    expect(screen.queryByText("Clawnetes with OpenClaw OpenClaw 2026.4.8 (abe7b2c)")).not.toBeInTheDocument();
  });

  it("removes a saved previous remote from the environment dropdown and clears matching legacy storage", async () => {
    localStorage.setItem(
      "clawnetes.environments.v1",
      JSON.stringify([
        { id: "local-existing", name: "Local", type: "local", addedAt: 1, lastUsedAt: 10 },
        {
          id: "old-remote",
          name: "deploy@10.0.0.9",
          type: "cloud",
          remoteIp: "10.0.0.9",
          remoteUser: "deploy",
          addedAt: 2,
          lastUsedAt: 9,
        },
      ]),
    );
    localStorage.setItem(
      "clawnetes.remote.lastConnection.v1",
      JSON.stringify({ ip: "10.0.0.9", user: "deploy" }),
    );

    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    await user.click(screen.getByTestId("chat-env-dropdown").querySelector("button")!);
    expect(screen.getByText("deploy@10.0.0.9")).toBeInTheDocument();

    await user.click(screen.getByTestId("remove-environment-old-remote"));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("clawnetes.environments.v1") || "[]") as Array<{ id: string }>;
      expect(stored.some((env) => env.id === "old-remote")).toBe(false);
    });
    expect(localStorage.getItem("clawnetes.remote.lastConnection.v1")).toBeNull();

    await user.click(screen.getByTestId("chat-env-dropdown").querySelector("button")!);
    expect(screen.queryByText("deploy@10.0.0.9")).not.toBeInTheDocument();
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

  it("opens the Settings panel from the sidebar and closes back to chat", async () => {
    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    await openSettingsPanel(user);
    await user.click(screen.getByTestId("right-panel-close"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-sidebar-brand")).toHaveTextContent("Clawnetes");
    });
  });

  it("keeps the Recent empty state centered", async () => {
    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    const emptyState = screen.getByText("No past chats").closest(".text-center");
    expect(emptyState).not.toBeNull();
    expect(emptyState?.className).toContain("items-center");
  });

  it("opens the transcript at the bottom of the active chat", async () => {
    const user = userEvent.setup();
    const scrollState = mockTranscriptScrollState(0);
    await openInstalledLocalChat(user);

    await waitFor(() => {
      expect(screen.getByTestId("chat-sidebar-brand")).toHaveTextContent("Clawnetes");
    });

    expect(scrollState.getTop()).toBe(1600);
  });

  it("returns to the bottom of the active transcript after closing Settings", async () => {
    const user = userEvent.setup();
    const scrollState = mockTranscriptScrollState(420);
    await openInstalledLocalChat(user);

    await openSettingsPanel(user);
    scrollState.setTop(0);
    await user.click(screen.getByTestId("right-panel-close"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-sidebar-brand")).toHaveTextContent("Clawnetes");
    });

    expect(scrollState.getTop()).toBe(1600);
  });

  it("keeps internal weather transcript noise hidden after opening and closing Settings", async () => {
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

    await openSettingsPanel(user);
    await user.click(screen.getByTestId("right-panel-close"));

    await waitFor(() => {
      expect(screen.getAllByText("Tomorrow looks clear and cool.").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/Weather report for:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Timezone: Europe\/London/i)).not.toBeInTheDocument();
  });

  it("restores a handed-off scroll snapshot after chat remounts", async () => {
    const scrollState = mockTranscriptScrollState(275);
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket());

    const { unmount } = render(
      <ChatShell
        bootstrap={DIRECT_CHAT_BOOTSTRAP}
        bootstrapping={false}
        bootstrapError=""
        onRetryConnection={vi.fn()}
        onOpenConfigure={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
    });

    const selectionMap = JSON.parse(localStorage.getItem("clawnetes.chat.selection.v1") || "{}") as Record<string, string>;
    const activeThreadId = Object.values(selectionMap)[0];
    expect(activeThreadId).toBeTruthy();

    unmount();
    scrollState.setTop(0);

    const onConsumeReturnScrollSnapshot = vi.fn();
    render(
      <ChatShell
        bootstrap={DIRECT_CHAT_BOOTSTRAP}
        bootstrapping={false}
        bootstrapError=""
        onRetryConnection={vi.fn()}
        onOpenConfigure={vi.fn()}
        returnScrollSnapshot={{
          agentId: "main",
          sessionKey: "main",
          threadId: activeThreadId,
          scrollTop: 275,
        }}
        onConsumeReturnScrollSnapshot={onConsumeReturnScrollSnapshot}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(scrollState.getTop()).toBe(275);
      expect(onConsumeReturnScrollSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  it("restores an external handed-off snapshot when the agent and session still match even if the local thread id changed", async () => {
    const scrollState = mockTranscriptScrollState(0);
    const onConsumeReturnScrollSnapshot = vi.fn();
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket());

    render(
      <ChatShell
        bootstrap={DIRECT_CHAT_BOOTSTRAP}
        bootstrapping={false}
        bootstrapError=""
        onRetryConnection={vi.fn()}
        onOpenConfigure={vi.fn()}
        returnScrollSnapshot={{
          agentId: "main",
          sessionKey: "main",
          threadId: "stale-thread-id",
          scrollTop: 300,
        }}
        onConsumeReturnScrollSnapshot={onConsumeReturnScrollSnapshot}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
    });

    expect(scrollState.getTop()).toBe(300);
    expect(onConsumeReturnScrollSnapshot).toHaveBeenCalledTimes(1);
  });

  it("routes chat sends to the selected sub-agent session instead of main", async () => {
    const sentSessionKeys: string[] = [];
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket({
      sessions: [
        {
          agentId: "main",
          key: "agent:main:main",
          sessionId: "sess-1",
          displayName: "Main Session",
          derivedTitle: "Main Session",
          messages: [{ role: "assistant", content: [{ type: "text", text: "Welcome back." }], timestamp: Date.now() }],
        },
        {
          agentId: "ops",
          key: "agent:ops:main",
          sessionId: "sess-ops",
          displayName: "Ops Session",
          derivedTitle: "Ops Session",
          messages: [{ role: "assistant", content: [{ type: "text", text: "Ops ready." }], timestamp: Date.now() }],
        },
      ],
      onChatSend: (sessionKey) => {
        sentSessionKeys.push(sessionKey);
      },
    }));

    await openInstalledLocalChat(user);

    // Open dropdown and select ops agent
    await user.click(screen.getByTestId("chat-active-agent"));
    // Find the Ops agent option in the dropdown menu
    const opsOption = screen.getAllByRole("option").find(opt =>
      opt.textContent?.includes("Ops Agent")
    );
    expect(opsOption).toBeDefined();
    if (opsOption) {
      await user.click(opsOption);
    }

    await waitFor(() => {
      expect(screen.getAllByText("Ops ready.").length).toBeGreaterThan(0);
    });

    await user.type(screen.getByTestId("chat-composer"), "Handle this");
    await user.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(screen.getAllByText("Ops Agent handled it.").length).toBeGreaterThan(0);
    });

    expect(sentSessionKeys[sentSessionKeys.length - 1]).toBe("agent:ops:main");
  });

  it("deletes archived chats after confirmation and removes them from persisted storage", async () => {
    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    await user.click(screen.getByTestId("chat-new-session"));

    await waitFor(() => {
      expect(screen.getAllByText("Fresh start.").length).toBeGreaterThan(0);
    });

    const recentSectionHeader = screen.getByText("Recent").closest(".chat-sidebar-section");
    expect(recentSectionHeader).not.toBeNull();
    const archivedDeleteButton = recentSectionHeader
      ? Array.from(recentSectionHeader.querySelectorAll("button"))
        .find((button) => button.getAttribute("aria-label")?.includes("Delete chat"))
      : undefined;

    expect(archivedDeleteButton).toBeDefined();
    if (!archivedDeleteButton) {
      return;
    }

    await user.click(archivedDeleteButton);
    await waitFor(() => {
      expect(screen.getByText("Delete archived chat")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText("No past chats")).toBeInTheDocument();
    });

    const storedThreads = JSON.parse(localStorage.getItem("clawnetes.chat.threads.v1") || "{}");
    expect(JSON.stringify(storedThreads)).not.toContain("\"status\":\"archived\"");
  });

  it("deletes live chats after confirmation and persists the local dismissal", async () => {
    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    await waitFor(() => {
      expect(screen.getByText("Welcome back.")).toBeInTheDocument();
    });

    const liveDeleteButton = screen.getAllByRole("button")
      .find((button) => button.getAttribute("data-testid")?.startsWith("delete-chat-thread-"));
    expect(liveDeleteButton).toBeDefined();
    if (!liveDeleteButton) {
      return;
    }

    await user.click(liveDeleteButton);
    await waitFor(() => {
      expect(screen.getByText("Delete live chat")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText("No active chats")).toBeInTheDocument();
    });

    expect(localStorage.getItem("clawnetes.chat.hiddenLiveSessions.v1")).toContain("main");
  });

  it("preserves the selected sub-agent when the chat shell remounts", async () => {
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket({
      sessions: [
        {
          agentId: "main",
          key: "agent:main:main",
          sessionId: "sess-1",
          displayName: "Main Session",
          derivedTitle: "Main Session",
          messages: [{ role: "assistant", content: [{ type: "text", text: "Welcome back." }], timestamp: Date.now() }],
        },
        {
          agentId: "ops",
          key: "agent:ops:main",
          sessionId: "sess-ops",
          displayName: "Ops Session",
          derivedTitle: "Ops Session",
          messages: [{ role: "assistant", content: [{ type: "text", text: "Ops ready." }], timestamp: Date.now() }],
        },
      ],
    }));

    const onAgentSwitch = vi.fn();
    const { unmount } = render(
      <ChatShell
        bootstrap={DIRECT_CHAT_BOOTSTRAP}
        bootstrapping={false}
        bootstrapError=""
        onRetryConnection={vi.fn()}
        onOpenConfigure={vi.fn()}
        onAgentSwitch={onAgentSwitch}
        activeAgentId="ops"
        agents={[
          { id: "ops", name: "Ops Agent", emoji: "🛠️" },
        ] as any}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Ops ready.").length).toBeGreaterThan(0);
    });

    expect(screen.getByTestId("chat-active-agent")).toHaveTextContent("Ops Agent");

    unmount();

    render(
      <ChatShell
        bootstrap={DIRECT_CHAT_BOOTSTRAP}
        bootstrapping={false}
        bootstrapError=""
        onRetryConnection={vi.fn()}
        onOpenConfigure={vi.fn()}
        onAgentSwitch={onAgentSwitch}
        activeAgentId="ops"
        agents={[
          { id: "ops", name: "Ops Agent", emoji: "🛠️" },
        ] as any}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Ops ready.").length).toBeGreaterThan(0);
    });

    expect(screen.getByTestId("chat-active-agent")).toHaveTextContent("Ops Agent");
    expect(onAgentSwitch).not.toHaveBeenCalled();
  });

  it("routes main-agent chat sends to the canonical main session key", async () => {
    const sentSessionKeys: string[] = [];
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket({
      onChatSend: (sessionKey) => {
        sentSessionKeys.push(sessionKey);
      },
    }));

    await openInstalledLocalChat(user);

    await waitFor(() => {
      expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
    });

    await user.type(screen.getByTestId("chat-composer"), "Handle this");
    await user.click(screen.getByTestId("chat-send"));

    await waitFor(() => {
      expect(screen.getAllByText("Main Agent handled it.").length).toBeGreaterThan(0);
    });

    expect(sentSessionKeys[sentSessionKeys.length - 1]).toBe("agent:main:main");
  });

  it("shows the selected sub-agent model in the header instead of the main agent model", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket());

    render(
      <ChatShell
        bootstrap={DIRECT_CHAT_BOOTSTRAP}
        bootstrapping={false}
        bootstrapError=""
        onRetryConnection={vi.fn()}
        onOpenConfigure={vi.fn()}
        agents={[
          {
            id: "ops",
            name: "Ops Agent",
            emoji: "🛠️",
            model: "openai-codex/gpt-5.4",
            provider: "openai",
            fallbackModels: ["google/gemini-3.1-pro-preview"],
            skills: [],
            vibe: "",
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
          },
        ]}
        agentModelRef="google/gemini-3.1-pro-preview"
        agentFallbackCount={0}
        agentFallbackModels={[]}
        agentSkills={[]}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByTestId("chat-active-agent"));
    const opsOption = screen.getAllByRole("option").find((opt) => opt.textContent?.includes("Ops Agent"));
    expect(opsOption).toBeDefined();
    if (opsOption) {
      await user.click(opsOption);
    }

    await waitFor(() => {
      expect(screen.getByTestId("chat-model-badge")).toHaveTextContent("gpt-5.4");
      expect(screen.getByTestId("chat-model-badge")).toHaveTextContent("+1");
      expect(screen.getByTestId("chat-model-badge")).not.toHaveTextContent("gemini");
    });
  });

  it("removes a non-main agent from the UI and persisted config", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_prerequisites") {
        return Promise.resolve({ node_installed: true, docker_running: true, openclaw_installed: true });
      }
      if (cmd === "get_openclaw_version") {
        return Promise.resolve("2026.4.8");
      }
      if (cmd === "has_saved_license") {
        return Promise.resolve(false);
      }
      if (cmd === "get_current_config") {
        return Promise.resolve({
          provider: "google",
          api_key: "gemini-key",
          auth_method: "token",
          model: "google/gemini-3.1-pro-preview",
          user_name: "User",
          agent_name: "Main Agent",
          agent_emoji: "🤖",
          agent_type: "custom",
          telegram_token: "",
          gateway_port: 18789,
          gateway_bind: "127.0.0.1",
          gateway_auth_mode: "token",
          tailscale_mode: "off",
          node_manager: "auto",
          skills: [],
          service_keys: {},
          provider_auths: {
            google: {
              auth_method: "token",
              token: "gemini-key",
              profile_key: null,
              profile: null,
              oauth_provider_id: null,
            },
          },
          sandbox_mode: "workspace-write",
          allowed_tools: [],
          denied_tools: [],
          fallback_models: [],
          heartbeat_mode: "never",
          idle_timeout_ms: null,
          identity_md: "",
          user_md: "",
          soul_md: "",
          tools_md: "",
          agents_md: "",
          heartbeat_md: "",
          memory_md: "",
          memory_enabled: false,
          cron_jobs: [],
          enable_multi_agent: true,
          agent_configs: [
            {
              id: "ops",
              name: "Ops Agent",
              model: "openai-codex/gpt-5.4",
              fallback_models: [],
              skills: [],
              vibe: "",
              emoji: "🛠️",
              identity_md: "",
              user_md: "",
              soul_md: "",
              tools_md: "",
              agents_md: "",
              heartbeat_md: "",
              memory_md: "",
              heartbeat_mode: "never",
              idle_timeout_ms: null,
              memory_enabled: false,
              sandbox_mode: "workspace-write",
              provider: "openai",
              tools: {
                profile: "minimal",
                allow: [],
                deny: [],
                elevated: { enabled: false },
              },
            },
          ],
          preserve_state: true,
        });
      }
      if (cmd === "prepare_gateway_chat_connection") {
        return Promise.resolve({
          wsUrl: "ws://127.0.0.1:18789",
          authToken: "token-123",
          targetEnvironment: "local",
          gatewayPort: 18789,
          tunnelActive: false,
          openClawVersion: "2026.4.8",
        });
      }
      if (cmd === "configure_agent" || cmd === "restart_openclaw_gateway") {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    await user.click(screen.getByTestId("chat-active-agent"));
    const opsOption = screen.getAllByRole("option").find((opt) => opt.textContent?.includes("Ops Agent"));
    expect(opsOption).toBeDefined();
    if (opsOption) {
      await user.click(opsOption);
    }

    await waitFor(() => {
      expect(screen.getByTestId("chat-active-agent")).toHaveTextContent("Ops Agent");
    });

    await user.click(screen.getByTestId("chat-active-agent"));
    await user.click(screen.getByTestId("remove-agent-option"));
    expect(screen.getByTestId("chat-active-agent")).toHaveTextContent("Ops Agent");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-active-agent")).toHaveTextContent("Main Agent");
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "configure_agent",
      expect.objectContaining({
        config: expect.objectContaining({
          agents: null,
        }),
      }),
    );
  });

  it("keeps the agent when removal confirmation is canceled", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_prerequisites") {
        return Promise.resolve({ node_installed: true, docker_running: true, openclaw_installed: true });
      }
      if (cmd === "get_openclaw_version") {
        return Promise.resolve("2026.4.8");
      }
      if (cmd === "has_saved_license") {
        return Promise.resolve(false);
      }
      if (cmd === "get_current_config") {
        return Promise.resolve({
          provider: "google",
          api_key: "gemini-key",
          auth_method: "token",
          model: "google/gemini-3.1-pro-preview",
          user_name: "User",
          agent_name: "Main Agent",
          agent_emoji: "🤖",
          agent_type: "custom",
          telegram_token: "",
          gateway_port: 18789,
          gateway_bind: "127.0.0.1",
          gateway_auth_mode: "token",
          tailscale_mode: "off",
          node_manager: "auto",
          skills: [],
          service_keys: {},
          provider_auths: {
            google: {
              auth_method: "token",
              token: "gemini-key",
              profile_key: null,
              profile: null,
              oauth_provider_id: null,
            },
          },
          sandbox_mode: "workspace-write",
          allowed_tools: [],
          denied_tools: [],
          fallback_models: [],
          heartbeat_mode: "never",
          idle_timeout_ms: null,
          identity_md: "",
          user_md: "",
          soul_md: "",
          tools_md: "",
          agents_md: "",
          heartbeat_md: "",
          memory_md: "",
          memory_enabled: false,
          cron_jobs: [],
          enable_multi_agent: true,
          agent_configs: [
            {
              id: "ops",
              name: "Ops Agent",
              model: "openai-codex/gpt-5.4",
              fallback_models: [],
              skills: [],
              vibe: "",
              emoji: "🛠️",
              identity_md: "",
              user_md: "",
              soul_md: "",
              tools_md: "",
              agents_md: "",
              heartbeat_md: "",
              memory_md: "",
              heartbeat_mode: "never",
              idle_timeout_ms: null,
              memory_enabled: false,
              sandbox_mode: "workspace-write",
              provider: "openai",
              tools: {
                profile: "minimal",
                allow: [],
                deny: [],
                elevated: { enabled: false },
              },
            },
          ],
          preserve_state: true,
        });
      }
      if (cmd === "prepare_gateway_chat_connection") {
        return Promise.resolve({
          wsUrl: "ws://127.0.0.1:18789",
          authToken: "token-123",
          targetEnvironment: "local",
          gatewayPort: 18789,
          tunnelActive: false,
          openClawVersion: "2026.4.8",
        });
      }
      if (cmd === "configure_agent" || cmd === "restart_openclaw_gateway") {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    const user = userEvent.setup();
    await openInstalledLocalChat(user);

    await user.click(screen.getByTestId("chat-active-agent"));
    const opsOption = screen.getAllByRole("option").find((opt) => opt.textContent?.includes("Ops Agent"));
    expect(opsOption).toBeDefined();
    if (opsOption) {
      await user.click(opsOption);
    }

    await waitFor(() => {
      expect(screen.getByTestId("chat-active-agent")).toHaveTextContent("Ops Agent");
    });

    await user.click(screen.getByTestId("chat-active-agent"));
    await user.click(screen.getByTestId("remove-agent-option"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByTestId("chat-active-agent")).toHaveTextContent("Ops Agent");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "configure_agent",
      expect.objectContaining({
        config: expect.objectContaining({
          agents: null,
        }),
      }),
    );
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

  it("disables chat sends while a config update is in progress", async () => {
    vi.stubGlobal("WebSocket", createReconnectMockWebSocket());

    render(
      <ChatShell
        bootstrap={DIRECT_CHAT_BOOTSTRAP}
        bootstrapping={false}
        bootstrapError=""
        onRetryConnection={vi.fn()}
        onOpenConfigure={vi.fn()}
        isConfigUpdating
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Welcome back.").length).toBeGreaterThan(0);
    });

    expect(screen.getByTestId("chat-composer")).toBeDisabled();
    expect(screen.getByTestId("chat-send")).toBeDisabled();
    expect(screen.getByTestId("chat-config-banner")).toBeInTheDocument();
  });

  it("refreshes the active session after a config update completes", async () => {
    let phase: "before" | "after" = "before";

    vi.stubGlobal("WebSocket", createReconnectMockWebSocket({
      resolveSessionsForAgent: (_agentId) => [{
        agentId: "main",
        key: "agent:main:main",
        sessionId: phase === "before" ? "sess-before" : "sess-after",
        displayName: "Main Session",
        derivedTitle: "Main Session",
        messages: [],
      }],
      resolveHistoryForSession: (sessionKey) => ({
        agentId: "main",
        key: sessionKey,
        sessionId: phase === "before" ? "sess-before" : "sess-after",
        displayName: "Main Session",
        derivedTitle: "Main Session",
        messages: [{
          role: "assistant",
          content: [{
            type: "text",
            text: phase === "before" ? "Before reconfigure." : "After reconfigure.",
          }],
          timestamp: Date.now(),
        }],
      }),
    }));

    const { rerender } = render(
      <ChatShell
        bootstrap={DIRECT_CHAT_BOOTSTRAP}
        bootstrapping={false}
        bootstrapError=""
        onRetryConnection={vi.fn()}
        onOpenConfigure={vi.fn()}
        isConfigUpdating
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Before reconfigure.").length).toBeGreaterThan(0);
    });

    phase = "after";

    rerender(
      <ChatShell
        bootstrap={DIRECT_CHAT_BOOTSTRAP}
        bootstrapping={false}
        bootstrapError=""
        onRetryConnection={vi.fn()}
        onOpenConfigure={vi.fn()}
        isConfigUpdating={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("After reconfigure.").length).toBeGreaterThan(0);
    });
  });
});
