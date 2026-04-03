import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAllChatShellStorage,
  hideLiveSession,
  inferDocumentTheme,
  loadHiddenLiveSessions,
  loadSavedThemePreference,
  loadStoredSelection,
  loadThemePreference,
  removeStoredSelection,
  saveThemePreference,
  saveStoredSelection,
  saveStoredThreads,
  unhideLiveSession,
} from "../lib/chatShellStorage";

describe("chatShellStorage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: window.localStorage,
    });
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("clears all persisted chat shell data", () => {
    saveStoredThreads("scope-1", [
      {
        id: "thread-1",
        agentId: "main",
        sessionKey: "main",
        title: "Thread",
        preview: "Preview",
        updatedAt: 1,
        status: "live",
        messages: [],
      },
    ]);
    saveStoredSelection("scope-1", "main", "thread-1");
    saveThemePreference("dark");
    hideLiveSession("scope-1", "agent:main:main");

    clearAllChatShellStorage();

    expect(localStorage.getItem("clawnetes.chat.threads.v1")).toBeNull();
    expect(localStorage.getItem("clawnetes.chat.selection.v1")).toBeNull();
    expect(localStorage.getItem("clawnetes.chat.theme.v1")).toBeNull();
    expect(localStorage.getItem("clawnetes.chat.hiddenLiveSessions.v1")).toBeNull();
  });

  it("returns null when no explicit theme preference has been saved", () => {
    expect(loadSavedThemePreference()).toBeNull();
    expect(loadThemePreference()).toBe("system");
  });

  it("loads an explicit saved theme preference", () => {
    saveThemePreference("light");

    expect(loadSavedThemePreference()).toBe("light");
    expect(loadThemePreference()).toBe("light");
  });

  it("infers the active document theme and falls back to dark", () => {
    expect(inferDocumentTheme()).toBe("dark");

    document.documentElement.dataset.theme = "light";
    expect(inferDocumentTheme()).toBe("light");

    document.documentElement.dataset.theme = "dark";
    expect(inferDocumentTheme()).toBe("dark");
  });

  it("removes a stored selection only when it matches the deleted thread", () => {
    saveStoredSelection("scope-1", "main", "thread-1");

    removeStoredSelection("scope-1", "main", "thread-2");
    expect(loadStoredSelection("scope-1", "main")).toBe("thread-1");

    removeStoredSelection("scope-1", "main", "thread-1");
    expect(loadStoredSelection("scope-1", "main")).toBe("");
  });

  it("persists hidden live sessions and restores them", () => {
    hideLiveSession("scope-1", "agent:main:main");
    hideLiveSession("scope-1", "agent:main:main");

    expect(loadHiddenLiveSessions("scope-1")).toEqual(["agent:main:main"]);

    unhideLiveSession("scope-1", "agent:main:main");
    expect(loadHiddenLiveSessions("scope-1")).toEqual([]);
  });
});
