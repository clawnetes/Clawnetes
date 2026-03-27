import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import IntegrationHubPanel from "../panel/IntegrationHubPanel";

const DEFAULT_PROPS = {
  activeSkills: ["slack", "github"],
  serviceKeys: { slack: "xoxb-test" },
};

describe("IntegrationHubPanel", () => {
  it("renders the panel heading", () => {
    render(<IntegrationHubPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("integration-hub-panel")).toBeInTheDocument();
    expect(screen.getByText("Integrations")).toBeInTheDocument();
  });

  it("renders Messaging and Services sections", () => {
    render(<IntegrationHubPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Messaging")).toBeInTheDocument();
    expect(screen.getByText("Services")).toBeInTheDocument();
  });

  it("renders messaging integration cards", () => {
    render(<IntegrationHubPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("integration-card-slack")).toBeInTheDocument();
    expect(screen.getByTestId("integration-card-wacli")).toBeInTheDocument();
    expect(screen.getByTestId("integration-card-imsg")).toBeInTheDocument();
  });

  it("renders service integration cards", () => {
    render(<IntegrationHubPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("integration-card-github")).toBeInTheDocument();
    expect(screen.getByTestId("integration-card-gog")).toBeInTheDocument();
    expect(screen.getByTestId("integration-card-himalaya")).toBeInTheDocument();
  });

  it("shows Connected status for active skills with keys", () => {
    render(<IntegrationHubPanel {...DEFAULT_PROPS} />);
    // Slack is active and has a key
    const connectedBadges = screen.getAllByText("Connected");
    expect(connectedBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Disconnect button for connected integrations", () => {
    render(<IntegrationHubPanel {...DEFAULT_PROPS} />);
    const slackCard = screen.getByTestId("integration-card-slack");
    const disconnectBtn = slackCard.querySelector("button");
    expect(disconnectBtn?.textContent).toBe("Disconnect");
  });

  it("shows Setup button for non-active integrations", () => {
    render(<IntegrationHubPanel {...DEFAULT_PROPS} />);
    const whatsappCard = screen.getByTestId("integration-card-wacli");
    const setupBtn = whatsappCard.querySelector("button");
    expect(setupBtn?.textContent).toBe("Setup");
  });

  it("shows Available status for inactive integrations", () => {
    render(<IntegrationHubPanel {...DEFAULT_PROPS} />);
    const availableBadges = screen.getAllByText("Available");
    expect(availableBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onSetupIntegration when Setup button is clicked", async () => {
    const onSetup = vi.fn();
    const user = userEvent.setup();
    render(<IntegrationHubPanel {...DEFAULT_PROPS} onSetupIntegration={onSetup} />);
    const whatsappCard = screen.getByTestId("integration-card-wacli");
    const setupBtn = whatsappCard.querySelector("button");
    await user.click(setupBtn!);
    expect(onSetup).toHaveBeenCalledWith("wacli");
  });

  it("calls onToggleSkill when Disconnect button is clicked", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<IntegrationHubPanel {...DEFAULT_PROPS} onToggleSkill={onToggle} />);
    const slackCard = screen.getByTestId("integration-card-slack");
    const disconnectBtn = slackCard.querySelector("button");
    await user.click(disconnectBtn!);
    expect(onToggle).toHaveBeenCalledWith("slack", false);
  });

  it("renders Add Custom Integration buttons", () => {
    render(<IntegrationHubPanel {...DEFAULT_PROPS} />);
    const addBtns = screen.getAllByText("+ Add Custom Integration");
    // One for Messaging section, one for Services section
    expect(addBtns.length).toBe(2);
  });

  it("shows Connected for active non-auth skills (like GitHub with no key)", () => {
    // GitHub is active but doesn't require auth -> Connected
    render(
      <IntegrationHubPanel
        activeSkills={["github"]}
        serviceKeys={{}}
      />
    );
    const githubCard = screen.getByTestId("integration-card-github");
    const badge = githubCard.querySelector('[data-testid]') || githubCard;
    expect(githubCard.textContent).toContain("Connected");
  });
});
