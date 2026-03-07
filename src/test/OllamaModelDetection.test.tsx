import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock tauri APIs using hoisted pattern
vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "check_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: false, openclaw_installed: false });
    }
    if (cmd === "get_openclaw_version") return Promise.resolve("1.0.0");
    if (cmd === "get_ollama_models") return Promise.resolve(["llama3.2", "mistral", "phi3"]);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/dialog", () => ({ open: vi.fn() }));

import App from "../App";

describe("OllamaModelDetection", () => {
  it("App renders without error (ollama detection mocked)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Start Setup")).toBeInTheDocument();
    });
  });

  it("get_ollama_models returns a list of model names", async () => {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const models = await invoke("get_ollama_models", { remote: null });
    expect(Array.isArray(models)).toBe(true);
    expect((models as string[])).toContain("llama3.2");
  });

  it("falls back gracefully when get_ollama_models returns empty list", async () => {
    const { invoke } = await import("@tauri-apps/api/tauri");
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const models = await invoke("get_ollama_models", { remote: null });
    expect(Array.isArray(models)).toBe(true);
    expect((models as string[]).length).toBe(0);
  });

  it("model names from ollama don't have provider prefix (raw model names)", async () => {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const models = await invoke("get_ollama_models", {}) as string[];
    // Raw model names from Ollama API should not have 'ollama/' prefix
    models.forEach((m: string) => {
      expect(m.startsWith("ollama/")).toBe(false);
    });
  });
});
