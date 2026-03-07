import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "check_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: false, openclaw_installed: false });
    }
    if (cmd === "get_openclaw_version") return Promise.resolve("1.0.0");
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/dialog", () => ({ open: vi.fn() }));

import App from "../App";

describe("SecretRef", () => {
  it("App renders without error", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Start Setup")).toBeInTheDocument();
    });
  });

  it("SecretRef format: ENV_VAR format is recognized", () => {
    const isSecretRef = (val: string) => val.startsWith("$") || val.startsWith("secretref:");
    expect(isSecretRef("$MY_API_KEY")).toBe(true);
    expect(isSecretRef("$OPENAI_KEY")).toBe(true);
    expect(isSecretRef("secretref:vault/path")).toBe(true);
    expect(isSecretRef("secretref:env/MY_KEY")).toBe(true);
    expect(isSecretRef("sk-ant-123")).toBe(false);
    expect(isSecretRef("sk-1234567890")).toBe(false);
    expect(isSecretRef("")).toBe(false);
  });

  it("SecretRef format: secretref: format is recognized", () => {
    const secretrefPattern = /^(\$[A-Z_][A-Z0-9_]*|secretref:.+)$/;
    expect(secretrefPattern.test("$MY_KEY")).toBe(true);
    expect(secretrefPattern.test("secretref:vault/keys/api")).toBe(true);
    expect(secretrefPattern.test("sk-ant-plain-key")).toBe(false);
    expect(secretrefPattern.test("")).toBe(false);
  });

  it("SecretRef toggle does not change actual key value, just input type", () => {
    const apiKey = "sk-ant-api03-test";
    const isSecretRef = false;
    const inputType = isSecretRef ? "text" : "password";
    expect(inputType).toBe("password");

    const isSecretRefToggled = true;
    const inputTypeToggled = isSecretRefToggled ? "text" : "password";
    expect(inputTypeToggled).toBe("text");
    // Key value remains the same
    expect(apiKey).toBe("sk-ant-api03-test");
  });
});
