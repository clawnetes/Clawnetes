import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import Badge from "../ui/Badge";
import SearchInput from "../ui/SearchInput";
import TabBar from "../ui/TabBar";
import ToggleSwitch from "../ui/ToggleSwitch";
import ProviderLogo from "../ui/ProviderLogo";
import EmptyState from "../ui/EmptyState";
import LoadingSpinner from "../ui/LoadingSpinner";
import ConfirmDialog from "../ui/ConfirmDialog";

describe("Badge", () => {
  it("renders children text", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies variant class for active", () => {
    const { container } = render(<Badge variant="active">OK</Badge>);
    expect(container.firstChild).toHaveClass("bg-success/20");
  });

  it("applies neutral variant by default", () => {
    const { container } = render(<Badge>Default</Badge>);
    expect(container.firstChild).toHaveClass("bg-surface-hover");
  });

  it("applies custom className", () => {
    const { container } = render(<Badge className="my-class">Test</Badge>);
    expect(container.firstChild).toHaveClass("my-class");
  });
});

describe("SearchInput", () => {
  it("renders with placeholder", () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Search skills..." />);
    expect(screen.getByPlaceholderText("Search skills...")).toBeInTheDocument();
  });

  it("calls onChange when typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);
    await user.type(screen.getByRole("textbox"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("shows clear button when value is non-empty", () => {
    render(<SearchInput value="test" onChange={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("hides clear button when value is empty", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onChange with empty string when clear is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchInput value="test" onChange={onChange} />);
    await user.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("TabBar", () => {
  const tabs = [
    { id: "agents", label: "Agents" },
    { id: "model", label: "Model" },
    { id: "skills", label: "Skills" },
  ];

  it("renders all tabs", () => {
    render(<TabBar tabs={tabs} activeTab="agents" onTabChange={() => {}} />);
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
  });

  it("marks active tab with aria-selected", () => {
    render(<TabBar tabs={tabs} activeTab="model" onTabChange={() => {}} />);
    expect(screen.getByText("Model").closest("button")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Agents").closest("button")).toHaveAttribute("aria-selected", "false");
  });

  it("calls onTabChange when clicking a tab", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<TabBar tabs={tabs} activeTab="agents" onTabChange={onTabChange} />);
    await user.click(screen.getByText("Skills"));
    expect(onTabChange).toHaveBeenCalledWith("skills");
  });
});

describe("ToggleSwitch", () => {
  it("renders with aria-checked false when unchecked", () => {
    render(<ToggleSwitch checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("renders with aria-checked true when checked", () => {
    render(<ToggleSwitch checked={true} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with toggled value on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToggleSwitch checked={false} onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not call onChange when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToggleSwitch checked={false} onChange={onChange} disabled />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders with aria-label when provided", () => {
    render(<ToggleSwitch checked={false} onChange={() => {}} label="Enable feature" />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-label", "Enable feature");
  });

  it("uses CSS variable for off-state background instead of bg-surface-3", () => {
    render(<ToggleSwitch checked={false} onChange={() => {}} />);
    const track = screen.getByRole("switch");
    expect(track.className).not.toContain("bg-surface-3");
    expect(track.className).toContain("bg-[var(--surface-3)]");
    expect(track.className).toContain("border-[var(--border)]");
  });

  it("positions the knob symmetrically for on and off states", () => {
    const { rerender, container } = render(<ToggleSwitch checked={false} onChange={() => {}} />);
    const knob = container.querySelector("button[role='switch'] > span");
    expect(knob).toHaveClass("absolute");
    expect(knob).toHaveClass("left-[3px]");
    expect(knob).toHaveClass("translate-x-0");
    expect(knob).toHaveClass("-translate-y-1/2");

    rerender(<ToggleSwitch checked={true} onChange={() => {}} />);
    expect(container.querySelector("button[role='switch'] > span")).toHaveClass("translate-x-[18px]");
  });

  it("has a knob (span) element inside the track", () => {
    const { container } = render(<ToggleSwitch checked={false} onChange={() => {}} />);
    const knob = container.querySelector("button[role='switch'] > span");
    expect(knob).toBeInTheDocument();
    expect(knob).toHaveClass("rounded-full");
    expect(knob).toHaveClass("h-[16px]");
    expect(knob).toHaveClass("w-[16px]");
  });
});

describe("ProviderLogo", () => {
  it("renders an img for known providers", () => {
    render(<ProviderLogo provider="anthropic" />);
    const img = screen.getByAltText("anthropic");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/images/anthropic.svg");
  });

  it("renders initial fallback for unknown providers", () => {
    render(<ProviderLogo provider="unknown-provider" />);
    expect(screen.getByText("U")).toBeInTheDocument();
  });

  it("applies custom size", () => {
    render(<ProviderLogo provider="anthropic" size={24} />);
    const img = screen.getByAltText("anthropic");
    expect(img).toHaveAttribute("width", "24");
    expect(img).toHaveAttribute("height", "24");
  });
});

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No items" />);
    expect(screen.getByText("No items")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<EmptyState title="Empty" description="Nothing here yet." />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("renders action button when provided", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<EmptyState title="Empty" action={{ label: "Add item", onClick }} />);
    const btn = screen.getByText("Add item");
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not render action button when not provided", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("LoadingSpinner", () => {
  it("renders without label", () => {
    const { container } = render(<LoadingSpinner />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with label text", () => {
    render(<LoadingSpinner label="Loading..." />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("does not render when closed", () => {
    render(<ConfirmDialog open={false} title="Sure?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Sure?")).not.toBeInTheDocument();
  });

  it("renders title and description when open", () => {
    render(
      <ConfirmDialog open={true} title="Delete item?" description="This cannot be undone." onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText("Delete item?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog open={true} title="Sure?" onConfirm={onConfirm} onCancel={() => {}} confirmLabel="Yes" />);
    await user.click(screen.getByText("Yes"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog open={true} title="Sure?" onConfirm={() => {}} onCancel={onCancel} cancelLabel="No" />);
    await user.click(screen.getByText("No"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel on Escape key", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open={true} title="Sure?" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("uses custom button labels", () => {
    render(
      <ConfirmDialog open={true} title="Sure?" onConfirm={() => {}} onCancel={() => {}} confirmLabel="Delete" cancelLabel="Keep" />
    );
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Keep")).toBeInTheDocument();
  });
});
