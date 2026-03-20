import { describe, expect, it, vi } from "vitest";

import type { ProviderAuthConfig } from "../types";
import { executeDeferredOAuthQueue } from "../utils/oauthCompletion";

const successAuth = (profileKey: string): ProviderAuthConfig => ({
  auth_method: "openai-codex",
  token: "",
  profile_key: profileKey,
  profile: { type: "oauth" },
  oauth_provider_id: "openai-codex",
});

describe("executeDeferredOAuthQueue", () => {
  it("returns immediately for an empty queue", async () => {
    const invokeProviderAuth = vi.fn();

    const result = await executeDeferredOAuthQueue({
      queue: [],
      initialProviderAuths: {},
      invokeProviderAuth,
    });

    expect(result).toEqual({
      nextProviderAuths: {},
      successfulItems: [],
    });
    expect(invokeProviderAuth).not.toHaveBeenCalled();
  });

  it("processes a single provider successfully", async () => {
    const events: string[] = [];
    const queue = [
      {
        id: "provider:openai",
        label: "OpenAI",
        targetProvider: "openai",
        authMethod: "openai-codex",
        oauthProviderId: "openai-codex",
        source: "provider" as const,
        sourceId: "openai",
      },
    ];

    const result = await executeDeferredOAuthQueue({
      queue,
      initialProviderAuths: {},
      invokeProviderAuth: async () => successAuth("openai-codex:default"),
      onItemStart: (item) => events.push(`start:${item.id}`),
      onItemSuccess: (item) => events.push(`success:${item.id}`),
      onProviderBusyChange: (provider, busy) => events.push(`busy:${provider}:${busy}`),
      onProviderErrorChange: (provider, message) => events.push(`error:${provider}:${message}`),
    });

    expect(result.successfulItems).toEqual(queue);
    expect(result.nextProviderAuths.openai?.profile_key).toBe("openai-codex:default");
    expect(events).toEqual([
      "start:provider:openai",
      "busy:openai:true",
      "error:openai:",
      "success:provider:openai",
      "busy:openai:false",
    ]);
  });

  it("continues after a mid-queue failure", async () => {
    const queue = [
      {
        id: "provider:openai",
        label: "OpenAI",
        targetProvider: "openai",
        authMethod: "openai-codex",
        oauthProviderId: "openai-codex",
        source: "provider" as const,
        sourceId: "openai",
      },
      {
        id: "provider:google",
        label: "Google",
        targetProvider: "google",
        authMethod: "google-gemini-cli",
        oauthProviderId: "google-gemini-cli",
        source: "provider" as const,
        sourceId: "google",
      },
      {
        id: "skill:gemini",
        label: "Gemini CLI",
        targetProvider: "google",
        authMethod: "google-gemini-cli",
        oauthProviderId: "google-gemini-cli",
        source: "skill" as const,
        sourceId: "gemini",
      },
    ];

    const invokeProviderAuth = vi
      .fn()
      .mockResolvedValueOnce(successAuth("openai-codex:default"))
      .mockRejectedValueOnce(new Error("oauth denied"))
      .mockResolvedValueOnce({
        auth_method: "google-gemini-cli",
        token: "",
        profile_key: "google-gemini-cli:default",
        profile: { type: "oauth" },
        oauth_provider_id: "google-gemini-cli",
      });

    const itemErrors: string[] = [];

    const result = await executeDeferredOAuthQueue({
      queue,
      initialProviderAuths: {},
      invokeProviderAuth,
      onItemError: (item, message) => itemErrors.push(`${item.id}:${message}`),
    });

    expect(invokeProviderAuth).toHaveBeenCalledTimes(3);
    expect(result.successfulItems.map((item) => item.id)).toEqual([
      "provider:openai",
      "skill:gemini",
    ]);
    expect(itemErrors).toEqual(["provider:google:Error: oauth denied"]);
    expect(result.nextProviderAuths.openai?.profile_key).toBe("openai-codex:default");
    expect(result.nextProviderAuths.google?.profile_key).toBe("google-gemini-cli:default");
  });
});
