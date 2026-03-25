import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentOverviewPanel from "../panel/AgentOverviewPanel";

const MOCK_AGENTS = [
  { id: "agent-1", name: "Coding Bot" },
  { id: "agent-2", name: "Office Assistant" },
  { id: "agent-3" },
];

describe("AgentOverviewPanel", () => {
  it("renders the panel with correct agent count", () => {
    render(
      <AgentOverviewPanel
        agents={MOCK_AGENTS}
        activeAgentId="agent-1"
        onAgentSwitch={vi.fn()}
      />,
    );

    expect(screen.getByTestId("agent-overview-panel")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
  });

  it("displays agent names and falls back to id when name is missing", () => {
    render(
      <AgentOverviewPanel
        agents={MOCK_AGENTS}
        activeAgentId="agent-1"
        onAgentSwitch={vi.fn()}
      />,
    );

    expect(screen.getByText("Coding Bot")).toBeInTheDocument();
    expect(screen.getByText("Office Assistant")).toBeInTheDocument();
    expect(screen.getByText("agent-3")).toBeInTheDocument();
  });

  it("calls onAgentSwitch when clicking an agent card", async () => {
    const onSwitch = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentOverviewPanel
        agents={MOCK_AGENTS}
        activeAgentId="agent-1"
        onAgentSwitch={onSwitch}
      />,
    );

    await user.click(screen.getByTestId("agent-card-agent-2"));
    expect(onSwitch).toHaveBeenCalledWith("agent-2");
  });

  it("shows model info and skills on the active agent", () => {
    render(
      <AgentOverviewPanel
        agents={MOCK_AGENTS}
        activeAgentId="agent-1"
        onAgentSwitch={vi.fn()}
        modelRef="anthropic/claude-opus-4-6"
        skills={["github", "coding-agent", "web-search"]}
      />,
    );

    expect(screen.getByText("claude-opus-4-6")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
  });

  it("shows empty state when no agents are available", () => {
    render(
      <AgentOverviewPanel
        agents={[]}
        activeAgentId=""
        onAgentSwitch={vi.fn()}
      />,
    );

    expect(screen.getByText("No agents available.")).toBeInTheDocument();
  });

  it("keeps the Add Agent button disabled when no handler is provided", () => {
    render(
      <AgentOverviewPanel
        agents={MOCK_AGENTS}
        activeAgentId="agent-1"
        onAgentSwitch={vi.fn()}
      />,
    );

    expect(screen.getByTestId("add-agent-btn")).toBeDisabled();
  });

  it("shows the add-agent form when a handler is provided", async () => {
    const user = userEvent.setup();
    render(
      <AgentOverviewPanel
        agents={MOCK_AGENTS}
        activeAgentId="agent-1"
        onAgentSwitch={vi.fn()}
        onAddAgent={vi.fn()}
      />,
    );

    const addButton = screen.getByTestId("add-agent-btn");
    expect(addButton).not.toBeDisabled();

    await user.click(addButton);
    expect(screen.getByTestId("add-agent-form")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Emoji")).toBeInTheDocument();
    expect(screen.getByLabelText("Agent Type")).toBeInTheDocument();
  });

  it("submits a new preset-based agent from the form", async () => {
    const onAddAgent = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <AgentOverviewPanel
        agents={MOCK_AGENTS}
        activeAgentId="agent-1"
        onAgentSwitch={vi.fn()}
        onAddAgent={onAddAgent}
      />,
    );

    await user.click(screen.getByTestId("add-agent-btn"));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Release Captain");
    await user.selectOptions(screen.getByLabelText("Agent Type"), "office-assistant");
    await user.selectOptions(screen.getByLabelText("Emoji"), "🧠");
    await user.click(screen.getByRole("button", { name: "Create Agent" }));

    expect(onAddAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "release-captain",
        name: "Release Captain",
        emoji: "🧠",
        model: "anthropic/claude-opus-4-6",
        skills: expect.arrayContaining(["himalaya", "slack", "trello"]),
      }),
    );
  });

  it("shows fallback model count when fallback models are configured", () => {
    render(
      <AgentOverviewPanel
        agents={MOCK_AGENTS}
        activeAgentId="agent-1"
        onAgentSwitch={vi.fn()}
        fallbackModels={["google/gemini-3.1-pro-preview", "openai/gpt-5.4"]}
      />,
    );

    expect(screen.getByText("2 fallback models configured")).toBeInTheDocument();
  });
});
