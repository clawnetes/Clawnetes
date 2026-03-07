import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MODELS_BY_PROVIDER, DEFAULT_MODELS, PROVIDER_LOGOS } from "../presets/modelsByProvider";

vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "check_prerequisites") {
      return Promise.resolve({ node_installed: true, docker_running: false, openclaw_installed: false });
    }
    if (cmd === "get_openclaw_version") return Promise.resolve("1.0.0");
    if (cmd === "get_lmstudio_models") return Promise.resolve(["llama-3.2-3b-instruct", "mistral-7b"]);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/dialog", () => ({ open: vi.fn() }));

import App from "../App";

describe("LMStudioProvider", () => {
  it("lmstudio is present in DEFAULT_MODELS", () => {
    expect(DEFAULT_MODELS["lmstudio"]).toBeDefined();
    expect(DEFAULT_MODELS["lmstudio"]).toContain("lmstudio/");
  });

  it("lmstudio is present in MODELS_BY_PROVIDER", () => {
    expect(MODELS_BY_PROVIDER["lmstudio"]).toBeDefined();
    expect(Array.isArray(MODELS_BY_PROVIDER["lmstudio"])).toBe(true);
    expect(MODELS_BY_PROVIDER["lmstudio"].length).toBeGreaterThan(0);
  });

  it("lmstudio has logo in PROVIDER_LOGOS", () => {
    expect(PROVIDER_LOGOS["lmstudio"]).toBeDefined();
  });

  it("App renders without error", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Start Setup")).toBeInTheDocument();
    });
  });

  it("get_lmstudio_models mock returns model list", async () => {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const result = await invoke("get_lmstudio_models", { baseUrl: "http://localhost:1234", remote: null });
    expect(Array.isArray(result)).toBe(true);
    expect((result as string[])).toContain("llama-3.2-3b-instruct");
  });

  it("local provider is present in MODELS_BY_PROVIDER", () => {
    expect(MODELS_BY_PROVIDER["local"]).toBeDefined();
    expect(MODELS_BY_PROVIDER["local"].length).toBeGreaterThan(0);
  });

  it("local provider has DEFAULT_MODEL set", () => {
    expect(DEFAULT_MODELS["local"]).toBeDefined();
    expect(DEFAULT_MODELS["local"]).toContain("local/");
  });
});
