import { describe, expect, it } from "vitest";

import { applyModelProviderAuth, buildDeferredOAuthQueue, buildReferencedProviders, canUseProviderAuth, createDefaultProviderAuth, ensureProviderAuth, getDefaultModelForProvider, getDisplayModelOptions, getMissingReferencedProviders, getProviderAuthOptions, hasUsableProviderAuth, isOAuthMethod, normalizeModelRefForUi, normalizeProviderAuths } from "../utils/providerAuth";

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

  it("does not copy the previously selected provider credentials into a new provider entry", () => {
    const auths = ensureProviderAuth({
      openai: {
        auth_method: "token",
        token: "sk-openai",
        profile_key: null,
        profile: null,
        oauth_provider_id: "openai-codex",
      },
    }, "google");

    expect(auths.openai.token).toBe("sk-openai");
    expect(auths.google).toEqual({
      auth_method: "token",
      token: "",
      profile_key: null,
      profile: null,
      oauth_provider_id: "google-gemini-cli",
    });
  });

  it("includes OAuth options for supported providers", () => {
    const openaiOptions = getProviderAuthOptions("openai").map(option => option.value);
    expect(openaiOptions).toContain("openai-codex");
  });

  it("keeps anthropic api key and setup-token options only", () => {
    const anthropicOptions = getProviderAuthOptions("anthropic");
    expect(anthropicOptions.map((option) => option.value)).toEqual(["token", "setup-token"]);
  });

  it("restricts google auth methods to gemini api key and gemini cli oauth", () => {
    const googleOptions = getProviderAuthOptions("google").map((option) => option.value);
    expect(googleOptions).toEqual(["token", "google-gemini-cli"]);
  });

  it("describes google oauth with the same unofficial-code-assist caution as openclaw", () => {
    const googleOauth = getProviderAuthOptions("google").find((option) => option.value === "google-gemini-cli");
    expect(googleOauth?.label).toContain("Google Gemini CLI OAuth");
    expect(googleOauth?.description).toContain("Unofficial Google Code Assist integration");
    expect(googleOauth?.description).toContain("account restrictions");
    expect(googleOauth?.description).toContain("GOOGLE_CLOUD_PROJECT");
  });

  it("marks only supported oauth methods as OAuth", () => {
    expect(isOAuthMethod("openai-codex")).toBe(true);
    expect(isOAuthMethod("google-gemini-cli")).toBe(true);
    expect(isOAuthMethod("token")).toBe(false);
    expect(isOAuthMethod("setup-token")).toBe(false);
    expect(isOAuthMethod("claude-cli")).toBe(false);
  });

  it("recognizes usable token and oauth auth records", () => {
    expect(hasUsableProviderAuth("google", {
      auth_method: "token",
      token: "AIza-test",
      profile_key: null,
      profile: null,
      oauth_provider_id: "google-gemini-cli",
    })).toBe(true);

    expect(hasUsableProviderAuth("google", {
      auth_method: "google-gemini-cli",
      token: "",
      profile_key: "google-gemini-cli:default",
      profile: { type: "oauth" },
      oauth_provider_id: "google-gemini-cli",
    })).toBe(true);

    expect(hasUsableProviderAuth("google", {
      auth_method: "token",
      token: "",
      profile_key: null,
      profile: null,
      oauth_provider_id: "google-gemini-cli",
    })).toBe(false);
  });

  it("treats pending oauth as usable only when the caller can launch oauth", () => {
    const auth = {
      auth_method: "google-gemini-cli",
      token: "",
      profile_key: null,
      profile: null,
      oauth_provider_id: "google-gemini-cli",
    };

    expect(canUseProviderAuth("google", auth)).toBe(false);
    expect(canUseProviderAuth("google", auth, {
      allowPendingOAuth: true,
      oauthHandlerAvailable: false,
    })).toBe(false);
    expect(canUseProviderAuth("google", auth, {
      allowPendingOAuth: true,
      oauthHandlerAvailable: true,
    })).toBe(true);
  });

  it("creates a default provider auth record", () => {
    expect(createDefaultProviderAuth("anthropic")).toEqual({
      auth_method: "token",
      token: "",
      profile_key: null,
      profile: null,
      oauth_provider_id: null,
    });
  });

  it("normalizes deprecated auth methods to supported options", () => {
    const auths = normalizeProviderAuths({
      anthropic: {
        auth_method: "claude-cli",
        token: "legacy-token",
        profile_key: "anthropic:default",
        profile: null,
        oauth_provider_id: "anthropic",
      },
      google: {
        auth_method: "google-antigravity",
        token: "legacy-google-token",
        profile_key: "google-antigravity:default",
        profile: null,
        oauth_provider_id: "google-antigravity",
      },
    }, "anthropic", "", "token");

    expect(auths.anthropic.auth_method).toBe("setup-token");
    expect(auths.anthropic.oauth_provider_id).toBeNull();
    expect(auths.google.auth_method).toBe("token");
    expect(auths.google.profile_key).toBeNull();
  });

  it("builds a deferred OAuth queue for supported oauth providers and OAuth skills", () => {
    const queue = buildDeferredOAuthQueue({
      referencedProviders: ["google"],
      providerAuths: {
        google: {
          auth_method: "google-gemini-cli",
          token: "",
          profile_key: null,
          profile: null,
          oauth_provider_id: "google-gemini-cli",
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
      expect.objectContaining({ id: "provider:google", targetProvider: "google", authMethod: "google-gemini-cli" }),
    ]);
  });

  it("reports missing auth for referenced providers", () => {
    expect(getMissingReferencedProviders({
      primaryModel: "google/gemini-3.1-pro-preview",
      fallbackModels: ["openai/gpt-5.4"],
      providerAuths: {
        openai: {
          auth_method: "token",
          token: "sk-openai",
          profile_key: null,
          profile: null,
          oauth_provider_id: "openai-codex",
        },
        google: {
          auth_method: "token",
          token: "",
          profile_key: null,
          profile: null,
          oauth_provider_id: "google-gemini-cli",
        },
      },
    })).toEqual(["google"]);
  });

  it("builds a deferred OAuth queue for Gemini skill auth even when no model references google", () => {
    const queue = buildDeferredOAuthQueue({
      referencedProviders: [],
      providerAuths: {
        google: {
          auth_method: "google-gemini-cli",
          token: "",
          profile_key: null,
          profile: null,
          oauth_provider_id: "google-gemini-cli",
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
      expect.objectContaining({
        id: "skill:gemini",
        targetProvider: "google",
        authMethod: "google-gemini-cli",
        oauthProviderId: "google-gemini-cli",
      }),
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

  it("repairs corrupted gemini model refs leaked into the openai-codex namespace", () => {
    const auths = {
      openai: {
        auth_method: "openai-codex",
        token: "",
        profile_key: "openai-codex:default",
        profile: {},
        oauth_provider_id: "openai-codex",
      },
      google: {
        auth_method: "token",
        token: "AIza-test",
        profile_key: null,
        profile: null,
        oauth_provider_id: null,
      },
    };

    expect(normalizeModelRefForUi("openai-codex/gemini-3.1-pro-preview", auths)).toBe("google/gemini-3.1-pro-preview");
    expect(applyModelProviderAuth("openai-codex/gemini-3.1-pro-preview", auths)).toBe("google/gemini-3.1-pro-preview");
    expect(getDisplayModelOptions("google", auths, { google: [{ value: "google/gemini-3.1-pro-preview", label: "Gemini" }] })[0]?.value)
      .toBe("google/gemini-3.1-pro-preview");
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
