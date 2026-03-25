import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import SkillsPanel from "../panel/SkillsPanel";

const DEFAULT_PROPS = {
  activeSkills: ["slack", "github"],
  serviceKeys: { slack: "xoxb-test" },
};

describe("SkillsPanel", () => {
  it("renders the panel heading", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("skills-panel")).toBeInTheDocument();
    expect(screen.getByText("Skills & Tools")).toBeInTheDocument();
  });

  it("renders the search input", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByPlaceholderText("Search skills...")).toBeInTheDocument();
  });

  it("renders skill categories", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Messaging")).toBeInTheDocument();
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.getByText("Utilities")).toBeInTheDocument();
  });

  it("shows active badge count for categories with active skills", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    // Messaging has "slack" active, Development has "github" active -> two "1 active" badges
    const activeBadges = screen.getAllByText("1 active");
    expect(activeBadges.length).toBe(2);
  });

  it("renders individual skill cards with names", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });

  it("shows Active badge on active skills", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    const slackCard = screen.getByTestId("skill-card-slack");
    expect(slackCard).toBeInTheDocument();
    // Active badges appear within skill cards for active skills
    const activeBadges = screen.getAllByText("Active");
    expect(activeBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("filters skills when searching", async () => {
    const user = userEvent.setup();
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    await user.type(screen.getByPlaceholderText("Search skills..."), "slack");
    expect(screen.getByText("Slack")).toBeInTheDocument();
    // GitHub should not be visible when searching for "slack"
    expect(screen.queryByTestId("skill-card-github")).not.toBeInTheDocument();
  });

  it("shows all skills again when search is cleared", async () => {
    const user = userEvent.setup();
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    const input = screen.getByPlaceholderText("Search skills...");
    await user.type(input, "slack");
    await user.clear(input);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });

  it("collapses a category when header is clicked", async () => {
    const user = userEvent.setup();
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    // Click the Messaging category header to collapse
    const messagingButton = screen.getByText("Messaging").closest("button");
    expect(messagingButton).toBeTruthy();
    await user.click(messagingButton!);
    // Skills inside Messaging should be hidden
    expect(screen.queryByTestId("skill-card-slack")).not.toBeInTheDocument();
  });

  it("updates local draft when toggle is clicked without calling save", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SkillsPanel {...DEFAULT_PROPS} onSaveSkillsConfig={onSave} />);
    // Toggle slack OFF (was active)
    const slackCard = screen.getByTestId("skill-card-slack");
    const toggle = slackCard.querySelector('[role="switch"]');
    expect(toggle).toBeTruthy();
    await user.click(toggle!);
    // Save should NOT be called on toggle
    expect(onSave).not.toHaveBeenCalled();
    // "Unsaved changes" should appear
    expect(screen.getByTestId("unsaved-indicator")).toBeInTheDocument();
  });

  it("shows Key needed badge for auth-required active skills without key", () => {
    render(
      <SkillsPanel
        activeSkills={["bluebubbles"]}
        serviceKeys={{}}
      />
    );
    expect(screen.getByText("Key needed")).toBeInTheDocument();
  });

  it("renders Save button", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("skills-save-button")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("Save button is disabled when there are no changes", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    const saveBtn = screen.getByTestId("skills-save-button");
    expect(saveBtn).toBeDisabled();
  });

  it("Save button is enabled after toggling a skill", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SkillsPanel {...DEFAULT_PROPS} onSaveSkillsConfig={onSave} />);
    const slackCard = screen.getByTestId("skill-card-slack");
    const toggle = slackCard.querySelector('[role="switch"]');
    await user.click(toggle!);
    const saveBtn = screen.getByTestId("skills-save-button");
    expect(saveBtn).not.toBeDisabled();
  });

  it("calls onSaveSkillsConfig with correct args when Save is clicked", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SkillsPanel {...DEFAULT_PROPS} onSaveSkillsConfig={onSave} />);
    // Toggle slack OFF
    const slackCard = screen.getByTestId("skill-card-slack");
    const toggle = slackCard.querySelector('[role="switch"]');
    await user.click(toggle!);
    // Click Save
    await user.click(screen.getByTestId("skills-save-button"));
    expect(onSave).toHaveBeenCalledTimes(1);
    // Skills: github only (slack removed), serviceKeys: slack key filtered since slack is off but key still in draft
    const [skills, keys] = onSave.mock.calls[0];
    expect(skills).toEqual(["github"]);
    // slack key is still in draftKeys but since it has a value, it stays
    expect(keys).toHaveProperty("slack", "xoxb-test");
  });

  it("shows API key input for auth-required active skills", () => {
    render(
      <SkillsPanel
        activeSkills={["bluebubbles"]}
        serviceKeys={{}}
        onSaveSkillsConfig={vi.fn()}
      />
    );
    const keyInput = screen.getByTestId("skill-key-input-bluebubbles");
    expect(keyInput).toBeInTheDocument();
    expect(keyInput).toHaveAttribute("type", "password");
    expect(keyInput).toHaveAttribute("placeholder", "Server URL & Password");
  });

  it("does NOT show API key input for OAuth skills", () => {
    render(
      <SkillsPanel
        activeSkills={["gemini"]}
        serviceKeys={{}}
        onSaveSkillsConfig={vi.fn()}
      />
    );
    expect(screen.queryByTestId("skill-key-input-gemini")).not.toBeInTheDocument();
  });

  it("typing in API key input enables Save button", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <SkillsPanel
        activeSkills={["bluebubbles"]}
        serviceKeys={{}}
        onSaveSkillsConfig={onSave}
      />
    );
    const saveBtn = screen.getByTestId("skills-save-button");
    expect(saveBtn).toBeDisabled();
    const keyInput = screen.getByTestId("skill-key-input-bluebubbles");
    await user.type(keyInput, "my-secret-key");
    expect(saveBtn).not.toBeDisabled();
  });

  it("shows Unsaved changes indicator when draft differs from props", async () => {
    const user = userEvent.setup();
    render(<SkillsPanel {...DEFAULT_PROPS} onSaveSkillsConfig={vi.fn()} />);
    expect(screen.queryByTestId("unsaved-indicator")).not.toBeInTheDocument();
    // Toggle a skill
    const slackCard = screen.getByTestId("skill-card-slack");
    const toggle = slackCard.querySelector('[role="switch"]');
    await user.click(toggle!);
    expect(screen.getByTestId("unsaved-indicator")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("shows Saving... text when saving prop is true", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} saving={true} />);
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("disables toggle switches when onSaveSkillsConfig is not provided", () => {
    render(<SkillsPanel {...DEFAULT_PROPS} />);
    const slackCard = screen.getByTestId("skill-card-slack");
    const toggle = slackCard.querySelector('[role="switch"]');
    expect(toggle).toBeDisabled();
  });
});
