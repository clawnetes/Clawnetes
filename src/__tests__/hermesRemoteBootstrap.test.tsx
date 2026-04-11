import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  invoke: invokeMock,
  openExternal: vi.fn(),
  openDialog: vi.fn(),
}));

vi.mock("../components/chat/ChatShell", () => ({
  default: (props: any) => (
    <div data-testid="chat-shell-mock">
      <div data-testid="mock-active-environment">{props.activeEnvironmentId || ""}</div>
      <div data-testid="mock-bootstrapping">{String(props.bootstrapping)}</div>
      <div data-testid="mock-bootstrap-ready">{String(Boolean(props.bootstrap))}</div>
      <div data-testid="mock-bootstrap-error">{props.bootstrapError || ""}</div>
      <div data-testid="mock-workspace-warning">{props.workspaceWarning || ""}</div>
      <div data-testid="mock-workspace-warning-pending">{String(Boolean(props.workspaceWarningPending))}</div>
      {(props.environments || []).map((env: { id: string; name: string }) => (
        <button
          key={env.id}
          type="button"
          data-testid={`switch-env-${env.id}`}
          onClick={() => props.onSwitchEnvironment?.(env.id)}
        >
          {env.name}
        </button>
      ))}
    </div>
  ),
}));

import App from "../App";

function setupBaseInvokeMock(options?: {
  bootstrapHangs?: boolean;
  remoteBootstrapHangs?: boolean;
  configRefreshHangs?: boolean;
}) {
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "check_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: true, openclaw_installed: true });
    }
    if (cmd === "check_platform_prerequisites") {
      return Promise.resolve({ node_installed: true, git_installed: true, platform_installed: true });
    }
    if (cmd === "get_openclaw_version") {
      return Promise.resolve("OpenClaw 2026.4.11");
    }
    if (cmd === "get_platform_version") {
      return Promise.resolve("Hermes Agent");
    }
    if (cmd === "has_saved_license") {
      return Promise.resolve(false);
    }
    if (cmd === "prepare_gateway_chat_connection") {
      return Promise.resolve({
        wsUrl: "ws://127.0.0.1:18789",
        authToken: "openclaw-token",
        targetEnvironment: "local",
        gatewayPort: 18789,
        tunnelActive: false,
        openClawVersion: "OpenClaw 2026.4.11",
      });
    }
    if (cmd === "prepare_platform_chat_bootstrap") {
      const remote = args?.remote as { ip?: string } | null | undefined;
      if (options?.bootstrapHangs) {
        return new Promise(() => {});
      }
      if (remote?.ip === "100.114.205.97" && options?.remoteBootstrapHangs) {
        return new Promise(() => {});
      }
      return Promise.resolve({
        wsUrl: "",
        authToken: "hermes-token",
        targetEnvironment: remote ? "cloud" : "local",
        gatewayPort: remote ? 28789 : 8642,
        tunnelActive: Boolean(remote),
        openClawVersion: "Hermes Agent",
        platform: "hermes",
        chatTransport: "hermes-api",
        apiBaseUrl: remote ? "http://127.0.0.1:28789/v1" : "http://127.0.0.1:8642/v1",
        apiKey: "hermes-key",
      });
    }
    if (cmd === "get_platform_config") {
      if (options?.configRefreshHangs) {
        return new Promise(() => {});
      }
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  });
}

describe("Hermes remote bootstrap", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-test" });
    vi.stubGlobal("navigator", { platform: "test", userAgent: "vitest", language: "en-GB" });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: window.localStorage,
    });
    vi.useRealTimers();
  });

  it("persists the remote Hermes environment immediately and keeps it active after a remount", async () => {
    setupBaseInvokeMock();

    localStorage.setItem(
      "clawnetes.environments.v1",
      JSON.stringify([
        {
          id: "local-hermes",
          name: "Local",
          platform: "hermes",
          type: "local",
          addedAt: 1,
          lastUsedAt: 2,
        },
        {
          id: "remote-hermes",
          name: "ubuntu@100.114.205.97",
          platform: "hermes",
          type: "cloud",
          remoteIp: "100.114.205.97",
          remoteUser: "ubuntu",
          addedAt: 3,
          lastUsedAt: 4,
        },
      ]),
    );
    localStorage.setItem("clawnetes.environments.active.v1", JSON.stringify("local-hermes"));

    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("step-platform-select")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("platform-card-hermes"));
    await user.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-environment")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("btn-continue"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-shell-mock")).toBeInTheDocument();
      expect(screen.getByTestId("mock-active-environment")).toHaveTextContent("local-hermes");
    });

    await user.click(screen.getByTestId("switch-env-remote-hermes"));

    expect(JSON.parse(localStorage.getItem("clawnetes.environments.active.v1") || "null")).toBe("remote-hermes");
    expect(screen.getByTestId("mock-active-environment")).toHaveTextContent("remote-hermes");

    expect(invokeMock).toHaveBeenCalledWith("prepare_platform_chat_bootstrap", {
      platform: "hermes",
      gatewayPort: expect.any(Number),
      remote: {
        ip: "100.114.205.97",
        user: "ubuntu",
        password: null,
        privateKeyPath: null,
      },
    });

    unmount();

    const userAfterRemount = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("step-platform-select")).toBeInTheDocument();
    });

    await userAfterRemount.click(screen.getByTestId("platform-card-hermes"));
    await userAfterRemount.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-environment")).toBeInTheDocument();
    });

    expect(screen.getByTestId("step-environment")).toBeInTheDocument();
    expect(screen.getByTestId("input-remote-ip")).toHaveValue("100.114.205.97");
    expect(screen.getByTestId("input-remote-user")).toHaveValue("ubuntu");
    expect(JSON.parse(localStorage.getItem("clawnetes.environments.active.v1") || "null")).toBe("remote-hermes");
  });

  it("shows a concrete Hermes bootstrap timeout instead of hanging forever", async () => {
    setupBaseInvokeMock({ bootstrapHangs: true });

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("step-platform-select")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("platform-card-hermes"));
    await user.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-environment")).toBeInTheDocument();
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-continue"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("chat-shell-mock")).toBeInTheDocument();
    expect(screen.getByTestId("mock-bootstrapping")).toHaveTextContent("true");
    expect(screen.getByTestId("mock-bootstrap-ready")).toHaveTextContent("false");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("mock-bootstrap-error").textContent).toContain(
      "Preparing the Hermes API connection timed out after 15 seconds.",
    );
    expect(screen.getByTestId("mock-bootstrap-ready")).toHaveTextContent("false");
    vi.useRealTimers();
  });

  it("shows a non-blocking warning when Hermes config refresh times out after bootstrap succeeds", async () => {
    setupBaseInvokeMock({ configRefreshHangs: true });

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("step-platform-select")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("platform-card-hermes"));
    await user.click(screen.getByTestId("btn-next"));

    await waitFor(() => {
      expect(screen.getByTestId("step-environment")).toBeInTheDocument();
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-continue"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("chat-shell-mock")).toBeInTheDocument();
    expect(screen.getByTestId("mock-bootstrap-ready")).toHaveTextContent("true");
    expect(screen.getByTestId("mock-bootstrapping")).toHaveTextContent("false");
    expect(screen.getByTestId("mock-workspace-warning-pending")).toHaveTextContent("true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("mock-workspace-warning").textContent).toContain(
      "Loading the saved Hermes configuration timed out after 15 seconds.",
    );
    expect(screen.getByTestId("mock-workspace-warning-pending")).toHaveTextContent("false");
    expect(screen.getByTestId("mock-bootstrap-ready")).toHaveTextContent("true");
    vi.useRealTimers();
  }, 15_000);
});
