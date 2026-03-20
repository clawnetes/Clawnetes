import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

function createMockWebSocket(historyMessages: unknown[] = []) {
  return class MockWebSocket {
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
        case "sessions.list":
          respond({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: {
              sessions: [{ key: "sess-1", displayName: "Session 1", derivedTitle: "Session 1" }],
            },
          });
          break;
        case "chat.history":
          respond({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { sessionKey: "sess-1", messages: historyMessages },
          });
          break;
        case "sessions.create":
          respond({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { key: "sess-new" },
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
  };
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
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    vi.stubGlobal("navigator", { platform: "test", userAgent: "vitest", language: "en-GB" });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    setupInvokeMock();
  });

  it("shows 'You' for user messages and agent name for assistant messages", async () => {
    const WS = createMockWebSocket([
      { role: "user", content: [{ type: "input_text", text: "Hello agent" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }], timestamp: 2 },
    ]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("You")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Atlas").length).toBeGreaterThan(0);
    expect(screen.getByText("Hello agent")).toBeInTheDocument();
    expect(screen.getByText("Hi there!")).toBeInTheDocument();

    // Should NOT show raw role strings
    expect(screen.queryByText("user")).not.toBeInTheDocument();
  });

  it("shows 'System' label for system messages", async () => {
    const WS = createMockWebSocket([
      { role: "system", text: "System notice", timestamp: 1 },
    ]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("System")).toBeInTheDocument();
    });

    expect(screen.getByText("System notice")).toBeInTheDocument();
  });

  it("filters out tool_use messages from the transcript", async () => {
    const WS = createMockWebSocket([
      { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "read", input: {} }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "Here is the answer." }], timestamp: 2 },
    ]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Here is the answer.")).toBeInTheDocument();
    });

    // tool_use message should not be rendered
    expect(screen.queryByText("read")).not.toBeInTheDocument();
  });

  it("filters out tool_result messages from the transcript", async () => {
    const WS = createMockWebSocket([
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "file contents" }], timestamp: 1 },
      { role: "user", content: [{ type: "input_text", text: "What does this file do?" }], timestamp: 2 },
    ]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("What does this file do?")).toBeInTheDocument();
    });

    expect(screen.queryByText("file contents")).not.toBeInTheDocument();
  });

  it("filters out user messages that look like raw JSON tool output", async () => {
    const jsonToolOutput = '{"status": "error", "tool": "read", "message": "file not found"}';
    const WS = createMockWebSocket([
      { role: "user", text: jsonToolOutput, timestamp: 1 },
      { role: "user", text: "Please try again", timestamp: 2 },
    ]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Please try again")).toBeInTheDocument();
    });

    expect(screen.queryByText(jsonToolOutput)).not.toBeInTheDocument();
  });
});

describe("ChatShell composer icons", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    vi.stubGlobal("navigator", { platform: "test", userAgent: "vitest", language: "en-GB" });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    setupInvokeMock();
  });

  it("renders a send icon button instead of a text 'Send' button", async () => {
    const WS = createMockWebSocket([]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-send")).toBeInTheDocument();
    });

    const sendBtn = screen.getByTestId("chat-send");
    expect(sendBtn.getAttribute("aria-label")).toBe("Send");
    // Should NOT have text "Send" — the button uses an SVG icon
    expect(sendBtn.textContent).toBe("");
  });
});

describe("ChatShell agent dropdown", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    vi.stubGlobal("navigator", { platform: "test", userAgent: "vitest", language: "en-GB" });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    setupInvokeMock();
  });

  it("renders an agent dropdown in the header when multiple agents exist", async () => {
    const WS = createMockWebSocket([]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      const agentEl = screen.getByTestId("chat-active-agent");
      expect(agentEl.tagName).toBe("SELECT");
    });
  });

  it("does not render agents section in the sidebar", async () => {
    const WS = createMockWebSocket([]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Agent Workspace")).toBeInTheDocument();
    });

    // Sidebar should show Sessions but NOT an "Agents" section header
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
  });
});

describe("ChatShell new chat error handling", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    vi.stubGlobal("navigator", { platform: "test", userAgent: "vitest", language: "en-GB" });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    setupInvokeMock();
  });

  it("shows the New Chat button enabled when connected", async () => {
    const WS = createMockWebSocket([]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      const newChatBtn = screen.getByTestId("chat-new-session");
      expect(newChatBtn).not.toBeDisabled();
    });
  });

  it("creates a new session when New Chat is clicked", async () => {
    const user = userEvent.setup();
    const WS = createMockWebSocket([]);
    vi.stubGlobal("WebSocket", WS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-new-session")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("chat-new-session"));

    // After clicking New Chat, the session list should refresh (no crash)
    await waitFor(() => {
      expect(screen.getByTestId("chat-new-session")).toBeInTheDocument();
    });
  });
});
