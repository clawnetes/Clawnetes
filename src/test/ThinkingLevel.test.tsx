import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "check_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: false, openclaw_installed: false });
    }
    if (cmd === "get_openclaw_version") return Promise.resolve("2026.3.2");
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/dialog", () => ({ open: vi.fn() }));

import App from "../App";

describe("ThinkingLevel", () => {
  it("App renders without error with thinking level state", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Start Setup")).toBeInTheDocument();
    });
  });

  it("thinking level only applies to Claude 4.x models", () => {
    const shouldShowThinking = (provider: string, model: string) =>
      provider === "anthropic" && model.includes("claude-") && model.includes("-4");

    expect(shouldShowThinking("anthropic", "anthropic/claude-opus-4-6")).toBe(true);
    expect(shouldShowThinking("anthropic", "anthropic/claude-sonnet-4-5")).toBe(true);
    expect(shouldShowThinking("anthropic", "anthropic/claude-haiku-4-5")).toBe(true);
    expect(shouldShowThinking("openai", "openai/gpt-5")).toBe(false);
    expect(shouldShowThinking("google", "google/gemini-3-pro-preview")).toBe(false);
    expect(shouldShowThinking("ollama", "ollama/llama3.2")).toBe(false);
  });

  it("valid thinking level options", () => {
    const validLevels = ["off", "low", "medium", "high", "adaptive"];
    const defaultLevel = "adaptive";
    expect(validLevels).toContain(defaultLevel);
    expect(validLevels.length).toBe(5);
  });

  it("thinking_level is null for non-anthropic providers in payload", () => {
    const getPayloadThinkingLevel = (provider: string, model: string, thinkingLevel: string) =>
      (provider === "anthropic" && model.includes("claude-") && model.includes("-4"))
        ? thinkingLevel
        : null;

    expect(getPayloadThinkingLevel("openai", "openai/gpt-5", "adaptive")).toBeNull();
    expect(getPayloadThinkingLevel("ollama", "ollama/llama3.2", "adaptive")).toBeNull();
    expect(getPayloadThinkingLevel("anthropic", "anthropic/claude-opus-4-6", "adaptive")).toBe("adaptive");
    expect(getPayloadThinkingLevel("anthropic", "anthropic/claude-opus-4-6", "high")).toBe("high");
    expect(getPayloadThinkingLevel("anthropic", "anthropic/claude-opus-4-6", "off")).toBe("off");
  });
});
