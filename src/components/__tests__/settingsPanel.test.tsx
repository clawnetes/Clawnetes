import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import SettingsPanel from "../panel/SettingsPanel";

const DEFAULT_PROPS = {
  targetEnvironment: "local",
  remoteSummary: "localhost:8080",
  gatewayPort: 8080,
  gatewayBind: "127.0.0.1",
  gatewayAuthMode: "token",
  heartbeatMode: "30m",
  sandboxMode: "none",
  idleTimeoutMs: 30000,
};

describe("SettingsPanel", () => {
  it("renders the panel heading", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders environment section with correct label", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Local Gateway")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows Remote Gateway for cloud environment", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} targetEnvironment="cloud" />);
    expect(screen.getByText("Remote Gateway")).toBeInTheDocument();
  });

  it("renders gateway settings", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Port")).toBeInTheDocument();
    expect(screen.getByText("8080")).toBeInTheDocument();
    expect(screen.getByText("Bind Address")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1")).toBeInTheDocument();
    expect(screen.getByText("Auth Mode")).toBeInTheDocument();
    expect(screen.getByText("token")).toBeInTheDocument();
  });

  it("renders session settings with heartbeat mode and sandbox mode", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Heartbeat Mode")).toBeInTheDocument();
    expect(screen.getByText("Sandbox Mode")).toBeInTheDocument();
    // Find the select element by looking for the None option
    const sandboxSelects = screen.getAllByRole("combobox");
    const sandboxSelect = sandboxSelects.find(select => (select as HTMLSelectElement).value === "none");
    expect(sandboxSelect).toBeInTheDocument();
  });

  it("renders all maintenance action buttons", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("settings-action-repair-system")).toBeInTheDocument();
    expect(screen.getByTestId("settings-action-security-audit")).toBeInTheDocument();
    expect(screen.getByTestId("settings-action-upgrade-openclaw")).toBeInTheDocument();
    expect(screen.getByTestId("settings-action-reconfigure")).toBeInTheDocument();
    expect(screen.getByTestId("settings-action-uninstall")).toBeInTheDocument();
  });

  it("renders maintenance buttons with the full label on one line and the description on the next", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} />);

    expect(screen.getByTestId("settings-action-label-repair-system")).toHaveTextContent("Repair System");
    expect(screen.getByTestId("settings-action-description-repair-system")).toHaveTextContent("Run openclaw doctor --repair");

    expect(screen.getByTestId("settings-action-label-security-audit")).toHaveTextContent("Security Audit");
    expect(screen.getByTestId("settings-action-description-security-audit")).toHaveTextContent("Run openclaw security audit --fix");

    expect(screen.getByTestId("settings-action-label-upgrade-openclaw")).toHaveTextContent("Upgrade OpenClaw");
    expect(screen.getByTestId("settings-action-description-upgrade-openclaw")).toHaveTextContent("Update the installed OpenClaw version");
  });

  it("centers the maintenance button text stack", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} />);

    expect(screen.getByTestId("settings-action-repair-system")).toHaveClass("text-center");
    expect(screen.getByTestId("settings-action-content-repair-system")).toHaveClass("items-center");
  });

  it("calls onRepair when Repair button is clicked", async () => {
    const onRepair = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel {...DEFAULT_PROPS} onRepair={onRepair} />);
    await user.click(screen.getByTestId("settings-action-repair-system"));
    expect(onRepair).toHaveBeenCalled();
  });

  it("calls onAudit when Security Audit button is clicked", async () => {
    const onAudit = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel {...DEFAULT_PROPS} onAudit={onAudit} />);
    await user.click(screen.getByTestId("settings-action-security-audit"));
    expect(onAudit).toHaveBeenCalled();
  });

  it("calls onUpgrade when Upgrade button is clicked", async () => {
    const onUpgrade = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel {...DEFAULT_PROPS} onUpgrade={onUpgrade} />);
    await user.click(screen.getByTestId("settings-action-upgrade-openclaw"));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("calls onUninstall when Uninstall button is clicked", async () => {
    const onUninstall = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel {...DEFAULT_PROPS} onUninstall={onUninstall} />);
    await user.click(screen.getByTestId("settings-action-uninstall"));
    expect(onUninstall).toHaveBeenCalled();
  });

  it("disables action buttons when busy", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} busy onRepair={vi.fn()} />);
    expect(screen.getByTestId("settings-action-repair-system")).toBeDisabled();
  });

  it("shows maintenance status message", () => {
    render(<SettingsPanel {...DEFAULT_PROPS} maintenanceStatus="Repairing system..." />);
    expect(screen.getByText("Repairing system...")).toBeInTheDocument();
  });

  it("shows dash for missing gateway values", () => {
    render(<SettingsPanel targetEnvironment="local" />);
    // All settings without values should show "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });
});
