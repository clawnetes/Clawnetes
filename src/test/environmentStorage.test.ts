import { beforeEach, describe, expect, it } from "vitest";

import {
  loadEnvironments,
  saveEnvironments,
  upsertEnvironment,
  removeEnvironment,
  getActiveEnvironmentId,
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
      { id: "1", name: "Local", type: "local" as const, addedAt: 1000, lastUsedAt: 2000 },
    ];
    saveEnvironments(envs);
    const loaded = loadEnvironments();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Local");
  });

  it("upsertEnvironment creates a new local entry", () => {
    const env = upsertEnvironment({ type: "local" });
    expect(env.type).toBe("local");
    expect(env.name).toBe("Local");
    expect(env.id).toBeTruthy();
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("upsertEnvironment creates a new cloud entry", () => {
    const env = upsertEnvironment({ type: "cloud", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });
    expect(env.type).toBe("cloud");
    expect(env.name).toBe("ubuntu@10.0.0.1");
    expect(env.remoteIp).toBe("10.0.0.1");
    expect(env.remoteUser).toBe("ubuntu");
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("upsertEnvironment deduplicates local environments", () => {
    upsertEnvironment({ type: "local" });
    upsertEnvironment({ type: "local" });
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("upsertEnvironment deduplicates cloud environments by ip+user", () => {
    upsertEnvironment({ type: "cloud", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });
    upsertEnvironment({ type: "cloud", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("upsertEnvironment creates separate entries for different cloud hosts", () => {
    upsertEnvironment({ type: "cloud", remoteIp: "10.0.0.1", remoteUser: "ubuntu" });
    upsertEnvironment({ type: "cloud", remoteIp: "10.0.0.2", remoteUser: "root" });
    expect(loadEnvironments()).toHaveLength(2);
  });

  it("upsertEnvironment updates lastUsedAt for existing entries", () => {
    const first = upsertEnvironment({ type: "local" });
    const firstUsedAt = first.lastUsedAt;
    // Force a small time gap
    const second = upsertEnvironment({ type: "local" });
    expect(second.id).toBe(first.id);
    expect(second.lastUsedAt).toBeGreaterThanOrEqual(firstUsedAt);
  });

  it("removeEnvironment deletes by id", () => {
    const env = upsertEnvironment({ type: "local" });
    removeEnvironment(env.id);
    expect(loadEnvironments()).toHaveLength(0);
  });

  it("removeEnvironment clears the active environment id when removing the active entry", () => {
    const env = upsertEnvironment({ type: "local" });
    setActiveEnvironmentId(env.id);
    removeEnvironment(env.id);
    expect(getActiveEnvironmentId()).toBeNull();
  });

  it("removeEnvironment is no-op for unknown id", () => {
    upsertEnvironment({ type: "local" });
    removeEnvironment("nonexistent");
    expect(loadEnvironments()).toHaveLength(1);
  });

  it("getActiveEnvironmentId returns null when not set", () => {
    expect(getActiveEnvironmentId()).toBeNull();
  });

  it("setActiveEnvironmentId and getActiveEnvironmentId round-trip", () => {
    setActiveEnvironmentId("env-123");
    expect(getActiveEnvironmentId()).toBe("env-123");
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
    expect(envs).toHaveLength(1);
    expect(envs[0].type).toBe("cloud");
    expect(envs[0].name).toBe("deploy@192.168.1.100");
    expect(envs[0].remoteIp).toBe("192.168.1.100");
    expect(envs[0].remoteUser).toBe("deploy");
  });

  it("stays empty after removing the only migrated environment and clearing legacy storage", () => {
    localStorage.setItem(
      "clawnetes.remote.lastConnection.v1",
      JSON.stringify({ ip: "192.168.1.100", user: "deploy" }),
    );
    const envs = loadEnvironments();
    removeEnvironment(envs[0].id);
    localStorage.removeItem("clawnetes.remote.lastConnection.v1");
    expect(loadEnvironments()).toEqual([]);
  });

  it("does not migrate if registry already exists", () => {
    const envs = [
      { id: "existing", name: "Local", type: "local" as const, addedAt: 1000, lastUsedAt: 2000 },
    ];
    saveEnvironments(envs);
    localStorage.setItem(
      "clawnetes.remote.lastConnection.v1",
      JSON.stringify({ ip: "10.0.0.1", user: "root" }),
    );
    expect(loadEnvironments()).toHaveLength(1);
    expect(loadEnvironments()[0].id).toBe("existing");
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
    const env = upsertEnvironment({ type: "local" });
    expect(env.type).toBe("local");
    removeEnvironment("any");
    expect(getActiveEnvironmentId()).toBeNull();
  });
});
