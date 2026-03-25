import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { useState, type ReactNode } from "react";
import ChatPanelContext, { type PanelView } from "../../context/ChatPanelContext";
import RightPanel from "../panel/RightPanel";

const DEFAULT_PROPS = {
  agents: [
    { id: "agent-1", name: "Test Agent", emoji: "🤖" },
    { id: "agent-2", name: "Second Agent", emoji: "💻" },
  ],
  activeAgentId: "agent-1",
  onAgentSwitch: vi.fn(),
  modelRef: "anthropic/claude-opus-4-6",
  fallbackModels: ["google/gemini-3.1-pro-preview"],
  skills: ["github", "coding-agent"],
};

function PanelWrapper({ initialView = "model" as PanelView, initialOpen = true, children }: { initialView?: PanelView; initialOpen?: boolean; children?: ReactNode }) {
  const [panelOpen, setPanelOpen] = useState(initialOpen);
  const [panelView, setPanelView] = useState<PanelView>(initialView);
  return (
    <ChatPanelContext.Provider
      value={{
        panelOpen,
        panelView,
        setPanelOpen,
        setPanelView,
        openPanel: (view) => { setPanelOpen(true); if (view) setPanelView(view); },
        closePanel: () => setPanelOpen(false),
      }}
    >
      {children || <RightPanel {...DEFAULT_PROPS} />}
    </ChatPanelContext.Provider>
  );
}

describe("RightPanel", () => {
  it("renders when open", () => {
    render(<PanelWrapper><RightPanel {...DEFAULT_PROPS} /></PanelWrapper>);
    expect(screen.getByTestId("right-panel")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("renders the 5-tab navigation without Agents tab", () => {
    render(<PanelWrapper><RightPanel {...DEFAULT_PROPS} /></PanelWrapper>);
    const tabs = screen.getAllByRole("tab");
    const tabLabels = tabs.map((tab) => tab.textContent);
    expect(tabLabels).toEqual(["Model", "Skills", "Identity", "Tools", "Advanced"]);
    expect(screen.queryByRole("tab", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Agents" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Integrations" })).not.toBeInTheDocument();
  });

  it("shows agent switcher dropdown in header", () => {
    render(<PanelWrapper><RightPanel {...DEFAULT_PROPS} /></PanelWrapper>);
    const agentSwitcher = screen.getByTestId("agent-switcher");
    expect(agentSwitcher).toBeInTheDocument();
    expect(agentSwitcher).toHaveValue("agent-1");
  });

  it("shows skills panel when clicking Skills tab", async () => {
    const user = userEvent.setup();
    render(<PanelWrapper><RightPanel {...DEFAULT_PROPS} activeSkills={["github"]} /></PanelWrapper>);
    await user.click(screen.getByText("Skills"));
    expect(screen.getByTestId("skills-panel")).toBeInTheDocument();
  });

  it("shows identity editor panel when clicking Identity tab", async () => {
    const user = userEvent.setup();
    render(<PanelWrapper><RightPanel {...DEFAULT_PROPS} identityMd="# Test" /></PanelWrapper>);
    await user.click(screen.getByText("Identity"));
    expect(screen.getByTestId("identity-editor-panel")).toBeInTheDocument();
  });

  it("shows settings panel when clicking Advanced tab", async () => {
    const user = userEvent.setup();
    render(<PanelWrapper><RightPanel {...DEFAULT_PROPS} targetEnvironment="local" /></PanelWrapper>);
    await user.click(screen.getByText("Advanced"));
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
  });

  it("shows tools panel when clicking Tools tab", async () => {
    const user = userEvent.setup();
    const toolPolicy = { profile: "minimal" as const, allow: [] as string[], deny: [] as string[] };
    render(<PanelWrapper><RightPanel {...DEFAULT_PROPS} toolPolicy={toolPolicy} /></PanelWrapper>);
    await user.click(screen.getByText("Tools"));
    expect(screen.getByTestId("tools-panel")).toBeInTheDocument();
  });

  it("closes panel when close button is clicked", async () => {
    const user = userEvent.setup();
    render(<PanelWrapper><RightPanel {...DEFAULT_PROPS} /></PanelWrapper>);
    await user.click(screen.getByTestId("right-panel-close"));
    const panel = screen.getByTestId("right-panel");
    // Panel remains in DOM without opacity manipulation (CSS grid handles visibility)
    expect(panel).toBeInTheDocument();
    expect(panel.className).not.toContain("opacity-0");
  });

  it("does not use opacity-0 when closed", () => {
    render(<PanelWrapper initialOpen={false}><RightPanel {...DEFAULT_PROPS} /></PanelWrapper>);
    const panel = screen.getByTestId("right-panel");
    // Panel is in the DOM; CSS grid width:0 hides it instead of opacity
    expect(panel).toBeInTheDocument();
    expect(panel.className).not.toContain("opacity-0");
    expect(panel.className).not.toContain("pointer-events-none");
  });

  it("shows model switcher panel for model tab", () => {
    render(<PanelWrapper initialView="model"><RightPanel {...DEFAULT_PROPS} /></PanelWrapper>);
    expect(screen.getByTestId("model-switcher-panel")).toBeInTheDocument();
    expect(screen.getByText("Primary Model")).toBeInTheDocument();
  });
});
