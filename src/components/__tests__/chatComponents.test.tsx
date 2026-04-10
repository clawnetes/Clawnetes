import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

const { openExternalMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  invoke: vi.fn(),
  openDialog: vi.fn(),
  openExternal: openExternalMock,
}));

import ChatMessageBody from "../chat/ChatMarkdown";
import ChatIcon, { ChatActionButton } from "../chat/ChatIcon";
import ChatComposer from "../chat/ChatComposer";
import ChatHeader from "../chat/ChatHeader";
import ChatSidebar from "../chat/ChatSidebar";
import ChatTranscript from "../chat/ChatTranscript";
import type { ChatMessage } from "../../lib/chatMessageFilters";
import type { AgentPlatform } from "../../platforms/types";

describe("ChatMessageBody", () => {
  it("renders plain text for user messages", () => {
    const message: ChatMessage = { id: "1", role: "user", text: "Hello world" };
    render(<ChatMessageBody message={message} />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders markdown for assistant messages", () => {
    const message: ChatMessage = { id: "2", role: "assistant", text: "**bold text**" };
    render(<ChatMessageBody message={message} />);
    expect(screen.getByText("bold text")).toBeInTheDocument();
    expect(screen.getByText("bold text").tagName).toBe("STRONG");
  });

  it("renders Thinking... for pending messages with no text", () => {
    const message: ChatMessage = { id: "3", role: "assistant", text: "", pending: true };
    render(<ChatMessageBody message={message} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("renders code blocks in assistant messages", () => {
    const message: ChatMessage = { id: "4", role: "assistant", text: "```js\nconst x = 1;\n```" };
    render(<ChatMessageBody message={message} />);
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  });

  it("autolinks bare urls in assistant messages", () => {
    const message: ChatMessage = { id: "5", role: "assistant", text: "Use https://openclaw.ai/docs for details." };
    render(<ChatMessageBody message={message} />);
    expect(screen.getByRole("link", { name: "https://openclaw.ai/docs" })).toHaveAttribute("href", "https://openclaw.ai/docs");
  });

  it("opens markdown links with the external opener", async () => {
    openExternalMock.mockReset();
    const user = userEvent.setup();
    const message: ChatMessage = { id: "6", role: "assistant", text: "[OpenClaw](https://openclaw.ai)" };
    render(<ChatMessageBody message={message} />);

    await user.click(screen.getByRole("link", { name: "OpenClaw" }));

    expect(openExternalMock).toHaveBeenCalledWith("https://openclaw.ai");
  });

  it("renders headings and blockquotes in assistant messages", () => {
    const message: ChatMessage = { id: "7", role: "assistant", text: "## Heading\n> Focus on the final answer." };
    render(<ChatMessageBody message={message} />);
    expect(screen.getByRole("heading", { name: "Heading", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Focus on the final answer.").closest("blockquote")).not.toBeNull();
  });
});

describe("ChatIcon", () => {
  it("renders an svg for known icon names", () => {
    const { container } = render(<ChatIcon name="plus" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders chat icon as default for unknown names", () => {
    const { container } = render(<ChatIcon name="unknown-icon" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("ChatActionButton", () => {
  it("renders label text", () => {
    render(<ChatActionButton icon={<span>I</span>} label="Reset" />);
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ChatActionButton icon={<span>I</span>} label="Click me" onClick={onClick} />);
    await user.click(screen.getByText("Click me"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("ChatComposer", () => {
  const baseProps = {
    composerValue: "",
    onComposerChange: vi.fn(),
    onSend: vi.fn(),
    onAbort: vi.fn(),
    canSend: false,
    chatReady: true,
    activeAgentId: "main",
    activeAgentName: "TestBot",
    activeThreadIsArchived: false,
    sending: false,
    activeRunId: "",
  };

  it("renders textarea with placeholder", () => {
    render(<ChatComposer {...baseProps} />);
    expect(screen.getByPlaceholderText("Message TestBot (Enter to send)")).toBeInTheDocument();
  });

  it("disables browser text assistance on the composer textarea", () => {
    render(<ChatComposer {...baseProps} />);
    const textarea = screen.getByTestId("chat-composer");
    expect(textarea).toHaveAttribute("autocomplete", "off");
    expect(textarea).toHaveAttribute("autocapitalize", "none");
    expect(textarea).toHaveAttribute("autocorrect", "off");
    expect(textarea).toHaveAttribute("spellcheck", "false");
  });

  it("shows archived message when thread is archived", () => {
    render(<ChatComposer {...baseProps} activeThreadIsArchived={true} />);
    expect(screen.getByPlaceholderText("Archived chats are read-only")).toBeInTheDocument();
  });

  it("shows send button when not sending", () => {
    render(<ChatComposer {...baseProps} />);
    expect(screen.getByLabelText("Send")).toBeInTheDocument();
  });

  it("shows stop button when sending", () => {
    render(<ChatComposer {...baseProps} sending={true} activeRunId="run-1" />);
    expect(screen.getByLabelText("Stop")).toBeInTheDocument();
  });

  it("shows thinking status when sending", () => {
    render(<ChatComposer {...baseProps} sending={true} />);
    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
  });

  it("calls onSend on Enter key", () => {
    const onSend = vi.fn();
    render(<ChatComposer {...baseProps} onSend={onSend} composerValue="hello" canSend={true} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("does not call onSend on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<ChatComposer {...baseProps} onSend={onSend} composerValue="hello" canSend={true} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("ChatHeader", () => {
  const baseProps = {
    agents: [{ id: "main", name: "TestBot", emoji: "🤖" }],
    activeAgentId: "main",
    activeAgentName: "TestBot",
    activeSessionKey: "main",
    activeThreadIsArchived: false,
    gatewayConnected: true,
    chatReady: true,
    showEmptyAgentState: false,
    onAgentSwitch: vi.fn(),
    onResetChat: vi.fn(),
    onRetryConnection: vi.fn(),
  };

  it("renders agent name as static text when single agent and no onAddAgent", () => {
    render(<ChatHeader {...baseProps} />);
    const el = screen.getByTestId("chat-active-agent");
    expect(el.tagName).toBe("H2");
    expect(el).toHaveTextContent("TestBot");
  });

  it("renders dropdown trigger when single agent with onAddAgent", () => {
    render(<ChatHeader {...baseProps} onAddAgent={vi.fn()} />);
    const button = screen.getByTestId("chat-active-agent");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveTextContent("🤖 TestBot");
    expect(button).toHaveAttribute("aria-haspopup", "listbox");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("renders dropdown when multiple agents", () => {
    const agents = [
      { id: "main", name: "Bot A" },
      { id: "sub", name: "Bot B" },
    ];
    render(<ChatHeader {...baseProps} agents={agents} />);
    const button = screen.getByTestId("chat-active-agent");
    expect(button.tagName).toBe("BUTTON");
  });

  it("lists all agents and + Add Agent in dropdown menu", async () => {
    const user = userEvent.setup();
    const agents = [
      { id: "main", name: "Bot A", emoji: "🤖" },
      { id: "sub", name: "Bot B", emoji: "💻" },
    ];
    render(<ChatHeader {...baseProps} agents={agents} onAddAgent={vi.fn()} />);
    await user.click(screen.getByTestId("chat-active-agent"));
    const menu = screen.getByTestId("agent-dropdown-menu");
    expect(menu).toBeInTheDocument();
    const options = menu.querySelectorAll("[role='option']");
    expect(options).toHaveLength(2);
    expect(screen.getByTestId("add-agent-option")).toHaveTextContent("+ Add Agent");
  });

  it("closes dropdown on Escape key", async () => {
    const user = userEvent.setup();
    render(<ChatHeader {...baseProps} onAddAgent={vi.fn()} />);
    await user.click(screen.getByTestId("chat-active-agent"));
    expect(screen.getByTestId("agent-dropdown-menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("agent-dropdown-menu")).not.toBeInTheDocument();
  });

  it("opens the add-agent modal from the dropdown and submits a preset-backed agent", async () => {
    const user = userEvent.setup();
    const onAddAgent = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatHeader
        {...baseProps}
        onAddAgent={onAddAgent}
        providerAuths={{
          anthropic: {
            auth_method: "token",
            token: "anthropic-test-key",
            profile_key: null,
            profile: null,
            oauth_provider_id: null,
          },
        }}
      />,
    );

    await user.click(screen.getByTestId("chat-active-agent"));
    await user.click(screen.getByTestId("add-agent-option"));

    expect(screen.getByTestId("add-agent-modal")).toBeInTheDocument();

    await user.click(screen.getByTestId("add-agent-preset-dropdown").querySelector("button")!);
    await user.click(screen.getByText("Office Assistant"));
    await user.click(screen.getByRole("button", { name: "Add Agent" }));

    expect(onAddAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Office Assistant",
        skills: expect.arrayContaining(["himalaya", "slack", "trello"]),
        agentsMd: expect.stringContaining("office assistant"),
      }),
    );
  });

  it("shows a remove option for non-main agents and calls the remove handler", async () => {
    const user = userEvent.setup();
    const onRemoveAgent = vi.fn();
    render(
      <ChatHeader
        {...baseProps}
        agents={[
          { id: "main", name: "TestBot", emoji: "🤖" },
          { id: "ops", name: "Ops", emoji: "🛠️" },
        ]}
        activeAgentId="ops"
        activeAgentName="Ops"
        onRemoveAgent={onRemoveAgent}
      />,
    );

    await user.click(screen.getByTestId("chat-active-agent"));
    await user.click(screen.getByTestId("remove-agent-option"));
    expect(onRemoveAgent).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Remove Agent")).toBeInTheDocument();
    expect(
      screen.getByText(
        'Remove agent "Ops"? This will also delete it from the saved OpenClaw configuration.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(onRemoveAgent).toHaveBeenCalledWith("ops");
  });

  it("does not remove an agent when the confirmation popup is canceled", async () => {
    const user = userEvent.setup();
    const onRemoveAgent = vi.fn();
    render(
      <ChatHeader
        {...baseProps}
        agents={[
          { id: "main", name: "TestBot", emoji: "🤖" },
          { id: "ops", name: "Ops", emoji: "🛠️" },
        ]}
        activeAgentId="ops"
        activeAgentName="Ops"
        onRemoveAgent={onRemoveAgent}
      />,
    );

    await user.click(screen.getByTestId("chat-active-agent"));
    await user.click(screen.getByTestId("remove-agent-option"));
    expect(onRemoveAgent).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onRemoveAgent).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows session key in metadata", () => {
    render(<ChatHeader {...baseProps} activeSessionKey="my-session" />);
    expect(screen.getByText("Session my-session")).toBeInTheDocument();
  });

  it("shows archived label for archived threads", () => {
    render(<ChatHeader {...baseProps} activeThreadIsArchived={true} />);
    expect(screen.getByText("Archived transcript")).toBeInTheDocument();
  });
});

describe("ChatTranscript", () => {
  const ref = { current: null };
  const baseProps = {
    transcriptRef: ref,
    transcriptEndRef: ref,
    showConnectingState: false,
    connectionLabel: "",
    shellError: "",
    showEmptyAgentState: false,
    loadingHistory: false,
    messages: [] as ChatMessage[],
    activeAgentName: "TestBot",
    activeThreadIsArchived: false,
    activeSessionKey: "main",
    onSetComposerValue: vi.fn(),
  };

  it("shows connecting state card", () => {
    render(<ChatTranscript {...baseProps} showConnectingState={true} connectionLabel="Connecting..." />);
    expect(screen.getByTestId("chat-connecting-state")).toBeInTheDocument();
  });

  it("shows a subtle config update banner without the connecting state card", () => {
    render(<ChatTranscript {...baseProps} isConfigUpdating={true} connectionLabel="Reconnecting..." />);
    expect(screen.getByTestId("chat-config-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-connecting-state")).not.toBeInTheDocument();
  });

  it("shows error state card", () => {
    render(<ChatTranscript {...baseProps} shellError="Connection lost" />);
    expect(screen.getByTestId("chat-error-state")).toBeInTheDocument();
    expect(screen.getByText("Connection lost")).toBeInTheDocument();
  });

  it("shows empty agent state", () => {
    render(<ChatTranscript {...baseProps} showEmptyAgentState={true} />);
    expect(screen.getByTestId("chat-empty-agent-state")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<ChatTranscript {...baseProps} loadingHistory={true} />);
    expect(screen.getByText("Loading session")).toBeInTheDocument();
  });

  it("shows empty stage with suggestion buttons when no messages", () => {
    render(<ChatTranscript {...baseProps} />);
    expect(screen.getByText("Let's build")).toBeInTheDocument();
  });

  it("renders message bubbles", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", text: "Hello" },
      { id: "2", role: "assistant", text: "Hi there" },
    ];
    render(<ChatTranscript {...baseProps} messages={messages} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });
});

describe("ChatSidebar", () => {
  const baseProps = {
    platform: "openclaw" as AgentPlatform,
    onSwitchPlatform: vi.fn(),
    canCreateChat: true,
    onNewChat: vi.fn(),
    liveThreads: [],
    archivedThreads: [],
    activeThreadId: "",
    onThreadSwitch: vi.fn(),
    onDeleteThread: vi.fn(),
    themePreference: "dark" as const,
    onThemeChange: vi.fn(),
    onOpenConfigure: vi.fn(),
    connectionLabel: "Connected",
  };

  it("renders a Settings button", () => {
    render(<ChatSidebar {...baseProps} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("opens the model panel when the Settings button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenPanel = vi.fn();
    render(<ChatSidebar {...baseProps} onOpenPanel={onOpenPanel} />);
    await user.click(screen.getByText("Settings"));
    expect(onOpenPanel).toHaveBeenCalledWith("model");
  });

  it("shows remove controls only for non-active cloud environments", async () => {
    const user = userEvent.setup();
    render(
      <ChatSidebar
        {...baseProps}
        environments={[
          { platform: "openclaw", id: "local", name: "Local", type: "local", addedAt: 1, lastUsedAt: 3 },
          { platform: "openclaw", id: "active", name: "ubuntu@10.0.0.8", type: "cloud", remoteIp: "10.0.0.8", remoteUser: "ubuntu", addedAt: 2, lastUsedAt: 2 },
          { platform: "openclaw", id: "old", name: "deploy@10.0.0.9", type: "cloud", remoteIp: "10.0.0.9", remoteUser: "deploy", addedAt: 3, lastUsedAt: 1 },
        ]}
        activeEnvironmentId="active"
        onSwitchEnvironment={vi.fn()}
        onRemoveEnvironment={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("chat-env-dropdown").querySelector("button")!);

    expect(screen.queryByTestId("remove-environment-local")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remove-environment-active")).not.toBeInTheDocument();
    expect(screen.getByTestId("remove-environment-old")).toBeInTheDocument();
  });

  it("opens a confirmation dialog before removing a saved remote", async () => {
    const user = userEvent.setup();
    const onRemoveEnvironment = vi.fn();
    const onSwitchEnvironment = vi.fn();
    render(
      <ChatSidebar
        {...baseProps}
        environments={[
          { platform: "openclaw", id: "active", name: "ubuntu@10.0.0.8", type: "cloud", remoteIp: "10.0.0.8", remoteUser: "ubuntu", addedAt: 2, lastUsedAt: 2 },
          { platform: "openclaw", id: "old", name: "deploy@10.0.0.9", type: "cloud", remoteIp: "10.0.0.9", remoteUser: "deploy", addedAt: 3, lastUsedAt: 1 },
        ]}
        activeEnvironmentId="active"
        onSwitchEnvironment={onSwitchEnvironment}
        onRemoveEnvironment={onRemoveEnvironment}
      />,
    );

    await user.click(screen.getByTestId("chat-env-dropdown").querySelector("button")!);
    await user.click(screen.getByTestId("remove-environment-old"));

    expect(onSwitchEnvironment).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Remove Remote Environment")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemoveEnvironment).toHaveBeenCalledWith("old");
  });

  it("does not remove a saved remote when the dialog is canceled", async () => {
    const user = userEvent.setup();
    const onRemoveEnvironment = vi.fn();
    render(
      <ChatSidebar
        {...baseProps}
        environments={[
          { platform: "openclaw", id: "active", name: "ubuntu@10.0.0.8", type: "cloud", remoteIp: "10.0.0.8", remoteUser: "ubuntu", addedAt: 2, lastUsedAt: 2 },
          { platform: "openclaw", id: "old", name: "deploy@10.0.0.9", type: "cloud", remoteIp: "10.0.0.9", remoteUser: "deploy", addedAt: 3, lastUsedAt: 1 },
        ]}
        activeEnvironmentId="active"
        onSwitchEnvironment={vi.fn()}
        onRemoveEnvironment={onRemoveEnvironment}
      />,
    );

    await user.click(screen.getByTestId("chat-env-dropdown").querySelector("button")!);
    await user.click(screen.getByTestId("remove-environment-old"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onRemoveEnvironment).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
