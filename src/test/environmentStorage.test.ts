import { beforeEach, describe, expect, it } from "vitest";

import {
  loadEnvironments,
  saveEnvironments,
  upsertEnvironment,
  removeEnvironment,
  getActiveEnvironmentId,
  getPreferredEnvironment,
  getPreferredEnvironmentForType,
  setActiveEnvironmentId,
} from "../lib/environmentStorage";

describe("environmentStorage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: window.localStorage,
    });
    localStorage.clear();
  });

  it("returns empty array when nothing saved", () => {
    expect(loadEnvironments()).toEqual([]);
  });

  it("saves and loads environments", () => {
    const envs = [
      { id: "1", name: "Local", platform: "openclaw" as const, type: "local" as const, addedAt: 1000, lastUsedAt: 2000 },
    ];
    saveEnvironments(envs);
    const loaded = loadEnvironments();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Local");
  });

  it("upsertEnvironment creates a new local entry", () => {
    const env = upsertEnvironment({ type: "local", platform: "openclaw" });
    expect(env.type).toBe("local");
    expect(env.name).toBe("Local");
    expect(env.platform).toBe("openclaw");
    expect(env.id).toBeTruthy();
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("upsertEnvironment creates a new cloud entry", () => {
    const env = upsertEnvironment({ type: "cloud", platform: "openclaw", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });
    expect(env.type).toBe("cloud");
    expect(env.name).toBe("ubuntu@10.0.0.1");
    expect(env.platform).toBe("openclaw");
    expect(env.remoteIp).toBe("10.0.0.1");
    expect(env.remoteUser).toBe("ubuntu");
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("upsertEnvironment deduplicates local environments", () => {
    upsertEnvironment({ type: "local", platform: "openclaw" });
    upsertEnvironment({ type: "local", platform: "openclaw" });
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("upsertEnvironment deduplicates cloud environments by ip+user", () => {
    upsertEnvironment({ type: "cloud", platform: "openclaw", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });
    upsertEnvironment({ type: "cloud", platform: "openclaw", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("upsertEnvironment creates separate entries for different cloud hosts", () => {
    upsertEnvironment({ type: "cloud", platform: "openclaw", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });
    upsertEnvironment({ type: "cloud", platform: "openclaw", remoteIp: "10.0.0.2", remoteUser: "root" });
    expect(loadEnvironments()).toHaveLength(2);
  });

  it("upsertEnvironment updates lastUsedAt for existing entries", () => {
    const first = upsertEnvironment({ type: "local", platform: "openclaw" });
    const firstUsedAt = first.lastUsedAt;
    // Force a small time gap
    const second = upsertEnvironment({ type: "local", platform: "openclaw" });
    expect(second.id).toBe(first.id);
    expect(second.lastUsedAt).toBeGreaterThanOrEqual(firstUsedAt);
  });

  it("creates separate local environments per platform", () => {
    upsertEnvironment({ type: "local", platform: "openclaw" });
    upsertEnvironment({ type: "local", platform: "hermes" });

    const environments = loadEnvironments();
    expect(environments).toHaveLength(2);
    expect(environments.map((env) => env.platform)).toEqual(["openclaw", "hermes"]);
  });

  it("creates separate cloud environments for the same host when the platform differs", () => {
    upsertEnvironment({ type: "cloud", platform: "openclaw", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });
    upsertEnvironment({ type: "cloud", platform: "hermes", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });

    const environments = loadEnvironments();
    expect(environments).toHaveLength(2);
    expect(environments.map((env) => env.platform)).toEqual(["openclaw", "hermes"]);
  });

  it("removeEnvironment deletes by id", () => {
    const env = upsertEnvironment({ type: "local", platform: "openclaw" });
    removeEnvironment(env.id);
    expect(loadEnvironments()).toHaveLength(0);
  });

  it("removeEnvironment clears the active environment id when removing the active entry", () => {
    const env = upsertEnvironment({ type: "local", platform: "openclaw" });
    setActiveEnvironmentId(env.id);
    removeEnvironment(env.id);
    expect(getActiveEnvironmentId()).toBeNull();
  });

  it("removeEnvironment is no-op for unknown id", () => {
    upsertEnvironment({ type: "local", platform: "openclaw" });
    removeEnvironment("nonexistent");
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("getActiveEnvironmentId returns null when not set", () => {
    expect(getActiveEnvironmentId()).toBeNull();
  });

  it("setActiveEnvironmentId and getActiveEnvironmentId round-trip for a saved environment", () => {
    const env = upsertEnvironment({ type: "local", platform: "openclaw" });
    setActiveEnvironmentId(env.id, env.platform);
    expect(getActiveEnvironmentId()).toBe(env.id);
  });

  it("tracks active environments independently per platform", () => {
    const openclaw = upsertEnvironment({ type: "local", platform: "openclaw" });
    const hermes = upsertEnvironment({ type: "local", platform: "hermes" });

    setActiveEnvironmentId(openclaw.id, "openclaw");
    setActiveEnvironmentId(hermes.id, "hermes");

    expect(getActiveEnvironmentId("openclaw")).toBe(openclaw.id);
    expect(getActiveEnvironmentId("hermes")).toBe(hermes.id);
    expect(getActiveEnvironmentId()).toBe(hermes.id);
  });

  it("returns the platform-specific preferred environment", () => {
    const openclawLocal = upsertEnvironment({ type: "local", platform: "openclaw" });
    const hermesRemote = upsertEnvironment({
      type: "cloud",
      platform: "hermes",
      remoteIp: "10.0.0.8",
      remoteUser: "ubuntu",
    });

    setActiveEnvironmentId(openclawLocal.id, "openclaw");
    setActiveEnvironmentId(hermesRemote.id, "hermes");

    expect(getPreferredEnvironment("openclaw")?.id).toBe(openclawLocal.id);
    expect(getPreferredEnvironment("hermes")?.id).toBe(hermesRemote.id);
  });

  it("returns the preferred environment for the requested platform and environment type", () => {
    const openclawLocal = upsertEnvironment({ type: "local", platform: "openclaw" });
    const openclawCloud = upsertEnvironment({
      type: "cloud",
      platform: "openclaw",
      remoteIp: "10.0.0.12",
      remoteUser: "ubuntu",
    });

    setActiveEnvironmentId(openclawCloud.id, "openclaw");

    expect(getPreferredEnvironmentForType("openclaw", "cloud")?.id).toBe(openclawCloud.id);
    expect(getPreferredEnvironmentForType("openclaw", "local")?.id).toBe(openclawLocal.id);
    expect(getPreferredEnvironmentForType("hermes", "cloud")).toBeNull();
  });

  it("handles corrupt localStorage data gracefully", () => {
    localStorage.setItem("clawnetes.environments.v1", "not-json");
    expect(loadEnvironments()).toEqual([]);
  });

  it("migrates from legacy remote connection storage", () => {
    localStorage.setItem(
      "clawnetes.remote.lastConnection.v1",
      JSON.stringify({ ip: "192.168.1.100", user: "deploy" }),
    );
    const envs = loadEnvironments();
    expect(envs).toEqual([]);
  });

  it("migrates legacy saved environments to openclaw", () => {
    localStorage.setItem(
      "clawnetes.environments.v1",
      JSON.stringify([
        { id: "legacy", name: "Local", type: "local", addedAt: 1000, lastUsedAt: 2000 },
      ]),
    );

    const envs = loadEnvironments();
    expect(envs).toHaveLength(1);
    expect(envs[0].platform).toBe("openclaw");
  });

  it("stays empty when only legacy remote storage exists", () => {
    localStorage.setItem(
      "clawnetes.remote.lastConnection.v1",
      JSON.stringify({ ip: "192.168.1.100", user: "deploy" }),
    );
    expect(loadEnvironments()).toEqual([]);
  });

  it("does not migrate if registry already exists", () => {
    const envs = [
      { id: "existing", name: "Local", platform: "openclaw" as const, type: "local" as const, addedAt: 1000, lastUsedAt: 2000 },
    ];
    saveEnvironments(envs);
    localStorage.setItem(
      "clawnetes.remote.lastConnection.v1",
      JSON.stringify({ ip: "10.0.0.1", user: "root" }),
    );
    expect(loadEnvironments()).toHaveLength(1);
    expect(loadEnvironments()[0].id).toBe("existing");
  });

  it("clears stale legacy remote data when saving the registry", () => {
    localStorage.setItem(
      "clawnetes.remote.lastConnection.v1",
      JSON.stringify({ ip: "10.0.0.1", user: "deploy" }),
    );

    saveEnvironments([
      { id: "local-1", name: "Local", platform: "openclaw" as const, type: "local" as const, addedAt: 1000, lastUsedAt: 2000 },
    ]);

    expect(localStorage.getItem("clawnetes.remote.lastConnection.v1")).toBeNull();
  });

  // Keep this test last since it breaks globalThis.localStorage
  it("handles localStorage being unavailable gracefully", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(loadEnvironments()).toEqual([]);
    const env = upsertEnvironment({ type: "local", platform: "openclaw" });
    expect(env.type).toBe("local");
    removeEnvironment("any");
    expect(getActiveEnvironmentId()).toBeNull();
  });
});
