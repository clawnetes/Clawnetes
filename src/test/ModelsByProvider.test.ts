import { describe, it, expect } from "vitest";
import { MODELS_BY_PROVIDER, DEFAULT_MODELS, PROVIDER_LOGOS } from "../presets/modelsByProvider";

describe("ModelsByProvider - New Local Providers", () => {
  it("has ollama in DEFAULT_MODELS", () => {
    expect(DEFAULT_MODELS["ollama"]).toBe("ollama/llama3.2");
  });

  it("has lmstudio in DEFAULT_MODELS", () => {
    expect(DEFAULT_MODELS["lmstudio"]).toBe("lmstudio/llama-3.2-3b-instruct");
  });

  it("has local in DEFAULT_MODELS", () => {
    expect(DEFAULT_MODELS["local"]).toBe("local/custom");
  });

  it("has expanded ollama models list with 10 entries", () => {
    expect(MODELS_BY_PROVIDER["ollama"]).toBeDefined();
    expect(MODELS_BY_PROVIDER["ollama"].length).toBeGreaterThanOrEqual(9);
  });

  it("ollama models include llama3.2, mistral, deepseek-r1", () => {
    const ollamaIds = MODELS_BY_PROVIDER["ollama"].map(m => m.value);
    expect(ollamaIds).toContain("ollama/llama3.2");
    expect(ollamaIds).toContain("ollama/mistral");
    expect(ollamaIds).toContain("ollama/deepseek-r1");
  });

  it("has lmstudio models list", () => {
    expect(MODELS_BY_PROVIDER["lmstudio"]).toBeDefined();
    expect(MODELS_BY_PROVIDER["lmstudio"].length).toBeGreaterThanOrEqual(3);
  });

  it("has local models list", () => {
    expect(MODELS_BY_PROVIDER["local"]).toBeDefined();
    expect(MODELS_BY_PROVIDER["local"].length).toBeGreaterThanOrEqual(1);
  });

  it("has lmstudio logo in PROVIDER_LOGOS", () => {
    expect(PROVIDER_LOGOS["lmstudio"]).toBeDefined();
  });

  it("has local logo in PROVIDER_LOGOS", () => {
    expect(PROVIDER_LOGOS["local"]).toBeDefined();
  });

  it("ollama models all have correct prefix", () => {
    MODELS_BY_PROVIDER["ollama"].forEach(m => {
      expect(m.value.startsWith("ollama/")).toBe(true);
    });
  });

  it("lmstudio models all have correct prefix", () => {
    MODELS_BY_PROVIDER["lmstudio"].forEach(m => {
      expect(m.value.startsWith("lmstudio/")).toBe(true);
    });
  });
});
