import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import Dropdown from "../Dropdown";

const basicOptions = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Charlie" },
];

const richOptions = [
  { value: "x", label: "Option X", description: "Desc for X", emoji: "🔥" },
  { value: "y", label: "Option Y", description: "Desc for Y", icon: "/icon-y.png" },
  { value: "z", label: "Option Z" },
];

describe("Dropdown", () => {
  it("renders placeholder when no value selected", () => {
    render(<Dropdown options={basicOptions} value="" onChange={() => {}} placeholder="Pick one" />);
    expect(screen.getByText("Pick one")).toBeInTheDocument();
  });

  it("renders selected option label", () => {
    render(<Dropdown options={basicOptions} value="b" onChange={() => {}} />);
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("opens panel on click and shows all options", async () => {
    render(<Dropdown options={basicOptions} value="" onChange={() => {}} />);
    const trigger = screen.getByRole("button");
    await userEvent.click(trigger);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("calls onChange when an option is clicked", async () => {
    const onChange = vi.fn();
    render(<Dropdown options={basicOptions} value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("Beta"));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("closes panel after selecting an option", async () => {
    const onChange = vi.fn();
    render(<Dropdown options={basicOptions} value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("Alpha"));
    // Panel should be gone — "Beta" option no longer visible
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("closes panel on click outside", async () => {
    render(
      <div>
        <span data-testid="outside">Outside</span>
        <Dropdown options={basicOptions} value="" onChange={() => {}} />
      </div>
    );
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("shows descriptions when provided", async () => {
    render(<Dropdown options={richOptions} value="" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Desc for X")).toBeInTheDocument();
    expect(screen.getByText("Desc for Y")).toBeInTheDocument();
  });

  it("shows emoji when provided", async () => {
    render(<Dropdown options={richOptions} value="x" onChange={() => {}} />);
    // Emoji should be visible in the trigger
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });

  it("shows icon when provided", async () => {
    render(<Dropdown options={richOptions} value="" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button"));
    const icon = screen.getByAltText("");
    expect(icon).toHaveAttribute("src", "/icon-y.png");
  });

  it("filters options when searchable", async () => {
    render(
      <Dropdown options={basicOptions} value="" onChange={() => {}} searchable />
    );
    await userEvent.click(screen.getByRole("button"));
    const searchInput = screen.getByPlaceholderText("Search...");
    await userEvent.type(searchInput, "alp");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
  });

  it("shows no results message when search has no matches", async () => {
    render(
      <Dropdown options={basicOptions} value="" onChange={() => {}} searchable />
    );
    await userEvent.click(screen.getByRole("button"));
    const searchInput = screen.getByPlaceholderText("Search...");
    await userEvent.type(searchInput, "zzzzz");
    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  it("disables browser text assistance on the searchable input", async () => {
    render(
      <Dropdown options={basicOptions} value="" onChange={() => {}} searchable />
    );
    await userEvent.click(screen.getByRole("button"));
    const searchInput = screen.getByPlaceholderText("Search...");
    expect(searchInput).toHaveAttribute("autocomplete", "off");
    expect(searchInput).toHaveAttribute("autocapitalize", "none");
    expect(searchInput).toHaveAttribute("autocorrect", "off");
    expect(searchInput).toHaveAttribute("spellcheck", "false");
  });

  it("shows checkmark on selected option", async () => {
    const { container } = render(
      <Dropdown options={basicOptions} value="b" onChange={() => {}} />
    );
    await userEvent.click(screen.getByRole("button"));
    // The selected option should have the .selected class
    const selectedOption = container.querySelector(".dropdown-option.selected");
    expect(selectedOption).toBeInTheDocument();
    expect(selectedOption).toHaveTextContent("Beta");
    // Should have a checkmark SVG
    const checkSvg = selectedOption?.querySelector(".dropdown-check");
    expect(checkSvg).toBeInTheDocument();
  });

  it("rotates chevron when open", async () => {
    const { container } = render(
      <Dropdown options={basicOptions} value="" onChange={() => {}} />
    );
    const chevron = container.querySelector(".dropdown-chevron");
    expect(chevron).not.toHaveClass("rotated");
    await userEvent.click(screen.getByRole("button"));
    const chevronAfter = container.querySelector(".dropdown-chevron");
    expect(chevronAfter).toHaveClass("rotated");
  });
});
