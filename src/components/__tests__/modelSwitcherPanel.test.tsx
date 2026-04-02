import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ModelSwitcherPanel from "../panel/ModelSwitcherPanel";

describe("ModelSwitcherPanel", () => {
  it("renders the provider/model editor always", () => {
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("model-switcher-panel")).toBeInTheDocument();
    expect(screen.getByText("Primary Model")).toBeInTheDocument();
    expect(screen.getByTestId("provider-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("model-dropdown")).toBeInTheDocument();
    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("does not show Save button when not dirty", () => {
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("model-save-btn")).not.toBeInTheDocument();
  });

  it("shows Save button when a different model is selected", async () => {
    const onModelChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={onModelChange}
      />,
    );

    expect(screen.queryByTestId("model-save-btn")).not.toBeInTheDocument();

    // Form is always visible, open the model dropdown and select a different model
    const modelDropdown = screen.getByTestId("model-dropdown");
    await user.click(modelDropdown.querySelector("button")!);
    // Find and click a different model option
    const haiku = screen.getByTestId("dropdown-option-anthropic/claude-haiku-4-5");
    await user.click(haiku);

    // Save button should now appear
    expect(screen.getByTestId("model-save-btn")).toBeInTheDocument();

    // Click save
    await user.click(screen.getByTestId("model-save-btn"));

    expect(onModelChange).toHaveBeenCalledWith("anthropic/claude-haiku-4-5");
  });

  it("does not call onModelChange when saving with the same model", () => {
    const onModelChange = vi.fn();
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={onModelChange}
      />,
    );

    // Save button should not exist when no changes have been made
    expect(screen.queryByTestId("model-save-btn")).not.toBeInTheDocument();
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it("discards changes when Cancel is clicked", async () => {
    const onModelChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={onModelChange}
      />,
    );

    // Make a change
    const modelDropdown = screen.getByTestId("model-dropdown");
    await user.click(modelDropdown.querySelector("button")!);
    const haiku = screen.getByTestId("dropdown-option-anthropic/claude-haiku-4-5");
    await user.click(haiku);

    // Cancel should reset to original model and hide Save button
    await user.click(screen.getByTestId("model-cancel-btn"));

    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("model-save-btn")).not.toBeInTheDocument();
  });

  it("displays fallback models and allows removing one", async () => {
    const onFallbacksChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={["google/gemini-3.1-pro-preview", "openai/gpt-5.4"]}
        onFallbacksChange={onFallbacksChange}
      />,
    );

    expect(screen.getByText("Fallback Models")).toBeInTheDocument();
    expect(screen.getByText("gemini-3.1-pro-preview")).toBeInTheDocument();

    // Remove a fallback and then save
    await user.click(screen.getByLabelText("Remove gemini-3.1-pro-preview"));

    // Save button should appear since fallbacks changed
    expect(screen.getByTestId("model-save-btn")).toBeInTheDocument();
    await user.click(screen.getByTestId("model-save-btn"));

    expect(onFallbacksChange).toHaveBeenCalledWith(["openai/gpt-5.4"]);
  });

  it("opens the fallback provider/model picker when add fallback is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onFallbacksChange={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("add-fallback-btn"));
    expect(screen.getByTestId("fallback-provider-dropdown")).toBeInTheDocument();
  });

  it("shows provider/model editor when currentModel is empty", () => {
    render(
      <ModelSwitcherPanel
        currentModel=""
        fallbackModels={[]}
        onModelChange={vi.fn()}
      />,
    );

    // Form should still be visible to let user select a model
    expect(screen.getByTestId("provider-dropdown")).toBeInTheDocument();
    expect(screen.getByText("Primary Model")).toBeInTheDocument();
  });

  it("shows auth section for remote providers and hides for local", () => {
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={vi.fn()}
        providerAuths={{}}
      />,
    );

    // Form is always visible, Anthropic is a remote provider — auth section should appear
    expect(screen.getByText("Authentication")).toBeInTheDocument();
  });

  it("disables browser text assistance on auth token inputs", () => {
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={vi.fn()}
        providerAuths={{}}
      />,
    );

    const input = screen.getByTestId("auth-token-input");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("shows masked credentials for providers with existing auth", () => {
    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={vi.fn()}
        providerAuths={{
          anthropic: {
            auth_method: "token",
            token: "sk-ant-test1234567890abcdef",
            profile_key: null,
            profile: null,
            oauth_provider_id: null,
          },
        }}
      />,
    );

    // Form is always visible
    expect(screen.getByTestId("auth-status")).toBeInTheDocument();
    expect(screen.getByText(/API Key: sk-••••cdef/)).toBeInTheDocument();
    expect(screen.getByTestId("auth-edit-btn")).toBeInTheDocument();
  });

  it("starts OAuth on save when an OAuth auth method is selected", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    const onProviderAuthChange = vi.fn();
    const onStartOAuth = vi.fn().mockResolvedValue({
      auth_method: "openai-codex",
      token: "",
      profile_key: "openai:default",
      profile: { type: "oauth" },
      oauth_provider_id: "openai-codex",
    });

    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={onModelChange}
        onProviderAuthChange={onProviderAuthChange}
        onStartOAuth={onStartOAuth}
        providerAuths={{}}
      />,
    );

    // Form is always visible
    await user.click(screen.getByTestId("provider-dropdown").querySelector("button")!);
    await user.click(screen.getByTestId("dropdown-option-openai"));
    await user.click(screen.getByTestId("auth-method-openai-codex"));
    await user.click(screen.getByTestId("model-save-btn"));

    await waitFor(() => {
      expect(onStartOAuth).toHaveBeenCalledWith("openai", "openai-codex", "openai-codex");
    });
    expect(onProviderAuthChange).not.toHaveBeenCalled();
    expect(onModelChange).toHaveBeenCalledWith("openai/gpt-5.4");
  });

  it("does not start OAuth again when the selected provider already has an OAuth profile", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    const onStartOAuth = vi.fn();

    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={onModelChange}
        onStartOAuth={onStartOAuth}
        providerAuths={{
          openai: {
            auth_method: "openai-codex",
            token: "",
            profile_key: "openai:default",
            profile: { type: "oauth" },
            oauth_provider_id: "openai-codex",
          },
        }}
      />,
    );

    // Form is always visible
    await user.click(screen.getByTestId("provider-dropdown").querySelector("button")!);
    await user.click(screen.getByTestId("dropdown-option-openai"));
    await user.click(screen.getByTestId("model-save-btn"));

    expect(onStartOAuth).not.toHaveBeenCalled();
    expect(onModelChange).toHaveBeenCalledWith("openai/gpt-5.4");
  });

  it("blocks saving a Gemini model when Google auth is missing", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();

    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={onModelChange}
        providerAuths={{}}
      />,
    );

    await user.click(screen.getByTestId("provider-dropdown").querySelector("button")!);
    await user.click(screen.getByTestId("dropdown-option-google"));

    expect(screen.getByTestId("missing-provider-auth-error")).toHaveTextContent(
      "Missing authentication for google.",
    );
    expect(screen.getByTestId("model-save-btn")).toBeDisabled();
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it("detects Ollama models and saves the first detected model by default", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    const onDetectLocalModels = vi.fn().mockResolvedValue(["llama3.2", "mistral"]);

    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={onModelChange}
        onDetectLocalModels={onDetectLocalModels}
      />,
    );

    // Form is always visible
    await user.click(screen.getByTestId("provider-dropdown").querySelector("button")!);
    await user.click(screen.getByTestId("dropdown-option-ollama"));
    await user.click(screen.getByTestId("detect-models-btn"));

    await waitFor(() => {
      expect(onDetectLocalModels).toHaveBeenCalledWith("ollama", undefined);
    });
    expect(screen.getByTestId("detected-model-llama3.2")).toBeInTheDocument();

    await user.click(screen.getByTestId("model-save-btn"));
    expect(onModelChange).toHaveBeenCalledWith("ollama/llama3.2");
  });

  it("passes the edited LM Studio base URL into model detection", async () => {
    const user = userEvent.setup();
    const onDetectLocalModels = vi.fn().mockResolvedValue(["mixtral"]);

    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={vi.fn()}
        onDetectLocalModels={onDetectLocalModels}
      />,
    );

    // Form is always visible
    await user.click(screen.getByTestId("provider-dropdown").querySelector("button")!);
    await user.click(screen.getByTestId("dropdown-option-lmstudio"));
    await user.clear(screen.getByTestId("local-base-url"));
    await user.type(screen.getByTestId("local-base-url"), "http://127.0.0.1:1235/v1");
    await user.click(screen.getByTestId("detect-models-btn"));

    await waitFor(() => {
      expect(onDetectLocalModels).toHaveBeenCalledWith("lmstudio", "http://127.0.0.1:1235/v1");
    });
  });

  it("disables browser text assistance on local model configuration inputs", async () => {
    const user = userEvent.setup();

    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("provider-dropdown").querySelector("button")!);
    await user.click(screen.getByTestId("dropdown-option-local"));

    const baseUrlInput = screen.getByTestId("local-base-url");
    const modelNameInput = screen.getByTestId("local-model-name");

    for (const input of [baseUrlInput, modelNameInput]) {
      expect(input).toHaveAttribute("autocomplete", "off");
      expect(input).toHaveAttribute("autocapitalize", "none");
      expect(input).toHaveAttribute("autocorrect", "off");
      expect(input).toHaveAttribute("spellcheck", "false");
    }
  });

  it("lets users enter a custom local endpoint model name before saving", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();

    render(
      <ModelSwitcherPanel
        currentModel="anthropic/claude-opus-4-6"
        fallbackModels={[]}
        onModelChange={onModelChange}
      />,
    );

    // Form is always visible
    await user.click(screen.getByTestId("provider-dropdown").querySelector("button")!);
    await user.click(screen.getByTestId("dropdown-option-local"));
    await user.clear(screen.getByTestId("local-model-name"));
    await user.type(screen.getByTestId("local-model-name"), "my-local-model");
    await user.click(screen.getByTestId("model-save-btn"));

    expect(onModelChange).toHaveBeenCalledWith("local/my-local-model");
  });
});
