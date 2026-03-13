import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ToolPolicyEditor from "../ToolPolicyEditor";

describe("ToolPolicyEditor", () => {
  it("switches profiles and toggles tools with overrides", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ToolPolicyEditor
        policy={{ profile: "minimal", allow: [], deny: [], elevatedEnabled: false }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /coding/i }));
    expect(onChange).toHaveBeenCalledWith({
      profile: "coding",
      allow: [],
      deny: [],
      elevatedEnabled: false,
    });
  });

  it("renders tool sections collapsed by default and expands only from the arrow button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ToolPolicyEditor
        policy={{ profile: "minimal", allow: [], deny: [], elevatedEnabled: false }}
        onChange={onChange}
      />,
    );

    expect(screen.queryByRole("button", { name: "Toggle read" })).not.toBeInTheDocument();

    await user.click(screen.getByText("Files"));
    expect(screen.queryByRole("button", { name: "Toggle read" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand Files" }));
    expect(screen.getByRole("button", { name: "Toggle read" })).toBeInTheDocument();
  });

  it("enables an extra tool outside the current profile", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ToolPolicyEditor
        policy={{ profile: "minimal", allow: [], deny: [], elevatedEnabled: false }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Expand Files" }));
    await user.click(screen.getByRole("button", { name: "Toggle read" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        profile: "minimal",
        allow: ["read"],
        deny: [],
      }),
    );
  });

  it("clears stale overrides when selecting a new profile", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ToolPolicyEditor
        policy={{ profile: "minimal", allow: ["read"], deny: ["session_status"], elevatedEnabled: true }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /coding/i }));
    expect(onChange).toHaveBeenLastCalledWith({
      profile: "coding",
      allow: [],
      deny: [],
      elevatedEnabled: true,
    });
  });
});
