import { describe, expect, it } from "vitest";

import { applyModelProviderAuth, buildDeferredOAuthQueue, buildReferencedProviders, createDefaultProviderAuth, getDefaultModelForProvider, getDisplayModelOptions, getProviderAuthOptions, isOAuthMethod, normalizeModelRefForUi, normalizeProviderAuths } from "../utils/providerAuth";

describe("providerAuth utilities", () => {
  it("builds a deduplicated set of referenced remote providers", () => {
    expect(buildReferencedProviders({
      primaryModel: "anthropic/claude-opus-4-6",
      fallbackModels: ["openai/gpt-5.4", "google/gemini-3.1-pro-preview", "openai/gpt-5.4"],
      agentConfigs: [
        { model: "lmstudio/local-model", fallbackModels: [] },
        { model: "xai/grok-4.1-fast", fallbackModels: ["local/custom"] },
      ],
    })).toEqual(["anthropic", "google", "openai", "xai"]);
  });

  it("normalizes auth state for the active provider", () => {
    const auths = normalizeProviderAuths({}, "openai", "sk-test", "token");
    expect(auths.openai.token).toBe("sk-test");
    expect(auths.openai.auth_method).toBe("token");
  });

  it("includes OAuth options for supported providers", () => {
    const openaiOptions = getProviderAuthOptions("openai").map(option => option.value);
    expect(openaiOptions).toContain("openai-codex");
  });

  it("labels anthropic claude-cli as the setup-token flow", () => {
    const anthropicOptions = getProviderAuthOptions("anthropic");
    expect(anthropicOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "claude-cli",
          label: "Claude Code Setup Token",
        }),
      ]),
    );
  });

  it("marks non-token auth methods as OAuth", () => {
    expect(isOAuthMethod("openai-codex")).toBe(true);
    expect(isOAuthMethod("token")).toBe(false);
  });

  it("creates a default provider auth record", () => {
    expect(createDefaultProviderAuth("anthropic")).toEqual({
      auth_method: "token",
      token: "",
      profile_key: null,
      profile: null,
      oauth_provider_id: "anthropic",
    });
  });

  it("builds a deferred OAuth queue for providers and OAuth skills", () => {
    const queue = buildDeferredOAuthQueue({
      referencedProviders: ["anthropic"],
      providerAuths: {
        anthropic: {
          auth_method: "claude-cli",
          token: "",
          profile_key: null,
          profile: null,
          oauth_provider_id: "anthropic",
        },
      },
      selectedSkills: ["gemini"],
      availableSkills: [
        {
          id: "gemini",
          name: "Gemini CLI",
          desc: "Gemini CLI",
          requiresAuth: true,
          authMode: "oauth",
          oauthBaseProvider: "google",
          oauthMethod: "google-gemini-cli",
          oauthProviderId: "google-gemini-cli",
        },
      ],
    });

    expect(queue).toEqual([
      expect.objectContaining({ id: "provider:anthropic", targetProvider: "anthropic", authMethod: "claude-cli" }),
      expect.objectContaining({ id: "skill:gemini", targetProvider: "google", authMethod: "google-gemini-cli" }),
    ]);
  });

  it("maps openai model refs to openai-codex when codex oauth is selected", () => {
    expect(applyModelProviderAuth("openai/gpt-5.4", {
      openai: {
        auth_method: "openai-codex",
        token: "",
        profile_key: "openai-codex:default",
        profile: null,
        oauth_provider_id: "openai-codex",
      },
    })).toBe("openai-codex/gpt-5.4");
  });

  it("maps openai-codex model refs back to openai when oauth is not selected", () => {
    expect(applyModelProviderAuth("openai-codex/gpt-5.4", {
      openai: {
        auth_method: "token",
        token: "sk-test",
        profile_key: null,
        profile: null,
        oauth_provider_id: "openai-codex",
      },
    })).toBe("openai/gpt-5.4");
  });

  it("normalizes openai-codex model refs to visible codex refs when codex oauth is selected", () => {
    const auths = {
      openai: {
        auth_method: "openai-codex",
        token: "",
        profile_key: "openai-codex:default",
        profile: null,
        oauth_provider_id: "openai-codex",
      },
    };

    expect(normalizeModelRefForUi("openai/gpt-5.4", auths)).toBe("openai-codex/gpt-5.4");
    expect(normalizeModelRefForUi("openai-codex/gpt-5.4", auths)).toBe("openai-codex/gpt-5.4");
  });

  it("keeps referenced providers keyed by the base provider when codex models are selected", () => {
    expect(buildReferencedProviders({
      primaryModel: "openai-codex/gpt-5.4",
      fallbackModels: ["openai-codex/gpt-5-mini", "anthropic/claude-opus-4-6"],
    })).toEqual(["anthropic", "openai"]);
  });

  it("builds codex-visible model options and defaults when codex oauth is selected", () => {
    const auths = {
      openai: {
        auth_method: "openai-codex",
        token: "",
        profile_key: "openai-codex:default",
        profile: null,
        oauth_provider_id: "openai-codex",
      },
    };
    const options = getDisplayModelOptions("openai", auths, {
      openai: [
        { value: "openai/gpt-5.4", label: "GPT-5.4" },
      ],
    });

    expect(options).toEqual([
      { value: "openai-codex/gpt-5.4", label: "openai-codex/gpt-5.4", description: undefined },
    ]);
    expect(getDefaultModelForProvider("openai", auths, { openai: "openai/gpt-5.4" })).toBe("openai-codex/gpt-5.4");
  });
});
