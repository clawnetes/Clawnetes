import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLastRemoteConnection,
  loadLastRemoteConnection,
  saveLastRemoteConnection,
} from "../lib/remoteConnectionStorage";

describe("remoteConnectionStorage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: window.localStorage,
    });
    localStorage.clear();
  });

  it("returns null when no connection has been saved", () => {
    expect(loadLastRemoteConnection()).toBeNull();
  });

  it("saves and loads a remote connection", () => {
    saveLastRemoteConnection("192.168.1.100", "ubuntu");
    const result = loadLastRemoteConnection();
    expect(result).toEqual({ ip: "192.168.1.100", user: "ubuntu" });
  });

  it("overwrites a previous connection on save", () => {
    saveLastRemoteConnection("10.0.0.1", "root");
    saveLastRemoteConnection("10.0.0.2", "admin");
    const result = loadLastRemoteConnection();
    expect(result).toEqual({ ip: "10.0.0.2", user: "admin" });
  });

  it("clears the saved connection", () => {
    saveLastRemoteConnection("192.168.1.100", "ubuntu");
    clearLastRemoteConnection();
    expect(loadLastRemoteConnection()).toBeNull();
  });

  it("returns null for corrupted data", () => {
    localStorage.setItem("clawnetes.remote.lastConnection.v1", "not-json");
    expect(loadLastRemoteConnection()).toBeNull();
  });

  it("returns null when stored object is missing fields", () => {
    localStorage.setItem(
      "clawnetes.remote.lastConnection.v1",
      JSON.stringify({ ip: "10.0.0.1" }),
    );
    expect(loadLastRemoteConnection()).toBeNull();
  });

  it("returns null when stored fields are not strings", () => {
    localStorage.setItem(
      "clawnetes.remote.lastConnection.v1",
      JSON.stringify({ ip: 123, user: null }),
    );
    expect(loadLastRemoteConnection()).toBeNull();
  });

  it("handles localStorage being unavailable gracefully", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(loadLastRemoteConnection()).toBeNull();
    saveLastRemoteConnection("10.0.0.1", "root");
    clearLastRemoteConnection();
  });
});
