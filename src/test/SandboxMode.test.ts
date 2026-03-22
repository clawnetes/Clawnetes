import { describe, expect, it } from "vitest";
import { toConfigSandboxMode, toUiSandboxMode } from "../utils/sandboxMode";

describe("sandbox mode mapping", () => {
  it("maps UI values to config values", () => {
    expect(toConfigSandboxMode("none")).toBe("off");
    expect(toConfigSandboxMode("partial")).toBe("non-main");
    expect(toConfigSandboxMode("full")).toBe("all");
  });

  it("maps config values to UI values", () => {
    expect(toUiSandboxMode("off")).toBe("none");
    expect(toUiSandboxMode("non-main")).toBe("partial");
    expect(toUiSandboxMode("all")).toBe("full");
  });

  it("accepts legacy/cross-layer values without changing meaning", () => {
    expect(toConfigSandboxMode("off")).toBe("off");
    expect(toConfigSandboxMode("non-main")).toBe("non-main");
    expect(toConfigSandboxMode("all")).toBe("all");
    expect(toUiSandboxMode("none")).toBe("none");
    expect(toUiSandboxMode("partial")).toBe("partial");
    expect(toUiSandboxMode("full")).toBe("full");
  });

  it("falls back safely to no sandbox", () => {
    expect(toConfigSandboxMode("unexpected")).toBe("off");
    expect(toUiSandboxMode("unexpected")).toBe("none");
    expect(toConfigSandboxMode(null)).toBe("off");
    expect(toUiSandboxMode(undefined)).toBe("none");
  });
});
