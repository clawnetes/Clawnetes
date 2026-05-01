import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  invoke: invokeMock,
  openExternal: vi.fn(),
  openDialog: vi.fn(),
}));

describe("Hermes Provider Switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: window.localStorage,
    });
    localStorage.clear();

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_prerequisites" || cmd === "check_platform_prerequisites") {
        return Promise.resolve({ node_installed: true, docker_running: true, openclaw_installed: true, platform_installed: true, git_installed: true });
      }
      if (cmd === "get_openclaw_version") return Promise.resolve("2026.4.8");
      if (cmd === "get_platform_version") return Promise.resolve("Hermes Agent");
      if (cmd === "has_saved_license") return Promise.resolve(false);
      if (cmd === "prepare_platform_chat_bootstrap") {
        return Promise.resolve({
          wsUrl: "",
          authToken: "hermes-token",
          targetEnvironment: "local",
          gatewayPort: 8642,
          tunnelActive: false,
          openClawVersion: "Hermes Agent",
          platform: "hermes",
          chatTransport: "hermes-api",
          apiBaseUrl: "http://127.0.0.1:8001/v1",
          apiKey: "hermes-key",
        });
      }
      if (cmd === "read_hermes_config") {
        return Promise.resolve({
          platform: "hermes",
          provider: "openai",
          model: "openai/gpt-4",
          hermesModelBaseUrl: "http://127.0.0.1:8001/v1",
          apiKey: "sk-123",
          authMethod: "token",
          providerAuths: {},
          agentConfigs: [],
          targetEnvironment: "local"
        });
      }
      if (cmd === "read_agent_config") {
        return Promise.resolve({
          platform: "hermes",
          provider: "openai",
          model: "openai/gpt-4",
          hermesModelBaseUrl: "http://127.0.0.1:8001/v1",
          apiKey: "sk-123",
          authMethod: "token",
          providerAuths: {},
          agentConfigs: [],
          targetEnvironment: "local"
        });
      }
      if (cmd === "check_messaging_link_status") {
        return Promise.resolve(false);
      }
      return Promise.resolve(null);
    });
  });

  it("clears hermesModelBaseUrl when switching to Gemini in the chat panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    // In this mocked environment, it skips "Start Setup" and goes straight to "step-platform-select"
    await waitFor(() => expect(screen.getByTestId("step-platform-select")).toBeInTheDocument());
    await user.click(screen.getByTestId("platform-card-hermes"));
    await user.click(screen.getByTestId("btn-next"));

    await waitFor(() => expect(screen.getByTestId("step-environment")).toBeInTheDocument());
    await user.click(screen.getByTestId("btn-continue"));

    // Wait for chat shell to load
    await waitFor(() => {
      expect(screen.getByTestId("chat-sidebar-brand")).toHaveTextContent("Clawnetes");
    });

    // 3. Open right panel (Model switcher)
    const settingsToggle = screen.getByRole("button", { name: "Settings" });
    await user.click(settingsToggle);
    
    await waitFor(() => {
      expect(screen.getByTestId("model-switcher-panel")).toBeInTheDocument();
    });

    // 4. Check initial stale base URL inside the panel's model config block
    // Wait, where is the base URL configured? 
    // It's in the ModelSwitcherPanel under "Advanced Configuration" -> "Local Inference / Base URL"
    // Let's type in the base URL or verify it. Actually, App.tsx passes it down.
    // If we can't easily click through the model switcher UI (because the DOM is complex), 
    // let's click the provider dropdown.
    const providerDropdown = screen.getByTestId("provider-dropdown");
    const dropdownBtn = providerDropdown.querySelector("button");
    if (dropdownBtn) await user.click(dropdownBtn);
    
    // 5. Select Gemini
    await waitFor(() => {
      expect(screen.getByText("Google")).toBeInTheDocument();
    });
    const geminiOption = screen.getByText("Google");
    await user.click(geminiOption);

    // Type API key so Save button is enabled
    const authInput = screen.getByTestId("auth-token-input");
    await user.type(authInput, "test-gemini-key");

    // Click Save
    const saveBtn = screen.getByTestId("model-save-btn");
    await user.click(saveBtn);

    // 6. Assert configure_platform was called with hermes_model_base_url: ""
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(c => c[0] === "configure_platform");
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1].config.hermes_model_base_url).toBe("");
      expect(lastCall[1].config.provider).toBe("google");
    });
  });
});
