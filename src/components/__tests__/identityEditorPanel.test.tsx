import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import IdentityEditorPanel from "../panel/IdentityEditorPanel";

const DEFAULT_PROPS = {
  identityMd: "# Identity\nI am Test Agent",
  soulMd: "You are a helpful assistant.",
  toolsMd: "## Tools\n- tool1",
  agentsMd: "",
  heartbeatMd: "",
  memoryMd: "",
};

describe("IdentityEditorPanel", () => {
  it("renders the panel heading", () => {
    render(<IdentityEditorPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("identity-editor-panel")).toBeInTheDocument();
    expect(screen.getByText("Identity Editor")).toBeInTheDocument();
  });

  it("renders all 6 sub-tabs", () => {
    render(<IdentityEditorPanel {...DEFAULT_PROPS} />);
    expect(screen.getByRole("tab", { name: /Identity/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Soul/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Tools/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Agents/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Heartbeat/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Memory/ })).toBeInTheDocument();
  });

  it("shows identity content by default", () => {
    render(<IdentityEditorPanel {...DEFAULT_PROPS} />);
    const textarea = screen.getByTestId("identity-editor-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("# Identity\nI am Test Agent");
  });

  it("disables browser text assistance on the editor textarea", () => {
    render(<IdentityEditorPanel {...DEFAULT_PROPS} />);
    const textarea = screen.getByTestId("identity-editor-textarea");
    expect(textarea).toHaveAttribute("autocomplete", "off");
    expect(textarea).toHaveAttribute("autocapitalize", "none");
    expect(textarea).toHaveAttribute("autocorrect", "off");
    expect(textarea).toHaveAttribute("spellcheck", "false");
  });

  it("switches content when clicking a different tab", async () => {
    const user = userEvent.setup();
    render(<IdentityEditorPanel {...DEFAULT_PROPS} />);
    await user.click(screen.getByRole("tab", { name: /Soul/ }));
    const textarea = screen.getByTestId("identity-editor-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("You are a helpful assistant.");
  });

  it("shows unsaved changes after editing", async () => {
    const user = userEvent.setup();
    render(<IdentityEditorPanel {...DEFAULT_PROPS} />);
    const textarea = screen.getByTestId("identity-editor-textarea");
    await user.clear(textarea);
    await user.type(textarea, "New identity content");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("does not show save/cancel buttons when no changes", () => {
    render(<IdentityEditorPanel {...DEFAULT_PROPS} />);
    expect(screen.queryByTestId("identity-save-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("identity-cancel-button")).not.toBeInTheDocument();
  });

  it("shows save and cancel buttons when content is modified", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<IdentityEditorPanel {...DEFAULT_PROPS} onSave={onSave} />);
    const textarea = screen.getByTestId("identity-editor-textarea");
    await user.clear(textarea);
    await user.type(textarea, "Modified");
    expect(screen.getByTestId("identity-save-button")).toBeInTheDocument();
    expect(screen.getByTestId("identity-cancel-button")).toBeInTheDocument();
  });

  it("calls onSave with correct tab and content when saving", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<IdentityEditorPanel {...DEFAULT_PROPS} onSave={onSave} />);
    const textarea = screen.getByTestId("identity-editor-textarea");
    await user.clear(textarea);
    await user.type(textarea, "Updated identity");
    await user.click(screen.getByTestId("identity-save-button"));
    expect(onSave).toHaveBeenCalledWith("identity", "Updated identity");
  });

  it("discards changes when Cancel is clicked", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<IdentityEditorPanel {...DEFAULT_PROPS} onSave={onSave} />);
    const textarea = screen.getByTestId("identity-editor-textarea") as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, "Temporary change");
    expect(textarea.value).toBe("Temporary change");

    // Click Cancel
    await user.click(screen.getByTestId("identity-cancel-button"));

    // Content should be reverted
    expect(textarea.value).toBe("# Identity\nI am Test Agent");
    // Save/Cancel buttons should disappear
    expect(screen.queryByTestId("identity-save-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("identity-cancel-button")).not.toBeInTheDocument();
    // onSave should not be called
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows dirty indicator on tab when content is modified", async () => {
    const user = userEvent.setup();
    render(<IdentityEditorPanel {...DEFAULT_PROPS} onSave={vi.fn()} />);
    const textarea = screen.getByTestId("identity-editor-textarea");
    await user.clear(textarea);
    await user.type(textarea, "Changed");
    // Switch to another tab
    await user.click(screen.getByRole("tab", { name: /Soul/ }));
    // The Identity tab should show a * indicator
    const identityTab = screen.getByRole("tab", { name: /Identity/ });
    expect(identityTab.textContent).toContain("*");
  });

  it("renders the template selector", () => {
    render(<IdentityEditorPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("template-selector")).toBeInTheDocument();
    expect(screen.getByText("Choose a persona template...")).toBeInTheDocument();
  });

  it("applies template when selected", async () => {
    const user = userEvent.setup();
    render(<IdentityEditorPanel {...DEFAULT_PROPS} onSave={vi.fn()} />);
    const select = screen.getByTestId("template-selector") as HTMLSelectElement;
    await user.selectOptions(select, "coding-assistant");
    const textarea = screen.getByTestId("identity-editor-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toContain("DevBot 9000");
  });

  it("shows Saving... when saving prop is true and content is dirty", async () => {
    const user = userEvent.setup();
    render(<IdentityEditorPanel {...DEFAULT_PROPS} saving onSave={vi.fn()} />);
    const textarea = screen.getByTestId("identity-editor-textarea");
    await user.clear(textarea);
    await user.type(textarea, "Changed");
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });
});
