import { beforeEach, describe, expect, it } from "vitest";

import { clearAllChatShellStorage, saveThemePreference, saveStoredSelection, saveStoredThreads } from "../lib/chatShellStorage";

describe("chatShellStorage", () => {
  beforeEach(() => {
    localStorage.clear();
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

    clearAllChatShellStorage();

    expect(localStorage.getItem("clawnetes.chat.threads.v1")).toBeNull();
    expect(localStorage.getItem("clawnetes.chat.selection.v1")).toBeNull();
    expect(localStorage.getItem("clawnetes.chat.theme.v1")).toBeNull();
  });
});
