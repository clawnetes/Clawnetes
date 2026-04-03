import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AddAgentModal from "../panel/AddAgentModal";

const defaultProviderAuths = {
  anthropic: {
    auth_method: "token",
    token: "",
    profile_key: null,
    profile: null,
    oauth_provider_id: null,
  },
  openai: {
    auth_method: "token",
    token: "",
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
};

function renderModal() {
  return render(
    <AddAgentModal
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      providerAuths={defaultProviderAuths}
      onProviderAuthChange={vi.fn()}
      onStartOAuth={vi.fn()}
      onDetectLocalModels={vi.fn().mockResolvedValue(["llama3.2", "qwen2.5"])}
    />,
  );
}

describe("AddAgentModal", () => {
  it("applies quick-fill presets to preset-backed markdown fields and leaves USER.md blank", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByTestId("add-agent-preset-dropdown").querySelector("button")!);
    await user.click(screen.getByText("Coding Assistant"));

    expect(screen.getByDisplayValue("Coding Assistant")).toBeInTheDocument();
    expect((screen.getByTestId("add-agent-identity-md") as HTMLTextAreaElement).value).toContain(
      "Coding Assistant",
    );
    expect((screen.getByTestId("add-agent-soul-md") as HTMLTextAreaElement).value).toContain(
      "Coding Assistant",
    );
    expect(screen.getByTestId("add-agent-user-md")).toHaveValue("");
  });

  it("does not add fallback models by default, even after applying a preset", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("tab", { name: "Model" }));
    expect(screen.getByText("No fallback models configured yet.")).toBeInTheDocument();
    expect(screen.queryByText("Fallback 1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Identity" }));
    await user.click(screen.getByTestId("add-agent-preset-dropdown").querySelector("button")!);
    await user.click(screen.getByText("Office Assistant"));
    await user.click(screen.getByRole("tab", { name: "Model" }));

    expect(screen.getByText("No fallback models configured yet.")).toBeInTheDocument();
    expect(screen.queryByText("Fallback 1")).not.toBeInTheDocument();
  });

  it("preserves custom draft name and emoji when applying a preset", async () => {
    const user = userEvent.setup();
    renderModal();

    const nameInput = screen.getByLabelText("Agent Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Release Captain");

    await user.click(screen.getByTestId("add-agent-emoji-dropdown").querySelector("button")!);
    await user.click(screen.getAllByText("🧠").at(-1)!);

    await user.click(screen.getByTestId("add-agent-preset-dropdown").querySelector("button")!);
    await user.click(screen.getByText("Office Assistant"));

    expect(screen.getByDisplayValue("Release Captain")).toBeInTheDocument();
    const identityValue = (screen.getByTestId("add-agent-identity-md") as HTMLTextAreaElement).value;
    expect(identityValue).toContain("Release Captain");
    expect(identityValue).toContain("🧠");
  });

  it("renders a single emoji glyph in the emoji dropdown trigger", () => {
    renderModal();

    const trigger = screen
      .getByTestId("add-agent-emoji-dropdown")
      .querySelector("button");

    expect(trigger).toHaveTextContent("🤖");
    expect(trigger?.textContent?.match(/🤖/g)).toHaveLength(1);
  });

  it("renders provider auth controls inline for primary and fallback providers", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("tab", { name: "Model" }));
    await user.click(screen.getByTestId("add-agent-primary-provider").querySelector("button")!);
    await user.click(screen.getAllByText("OpenAI").at(-1)!);

    await user.click(screen.getByRole("button", { name: "+ Add fallback" }));
    await user.click(screen.getByTestId("add-agent-fallback-provider-0").querySelector("button")!);
    await user.click(screen.getAllByText("Google").at(-1)!);

    expect(screen.getByTestId("add-agent-inline-auth-primary-openai")).toBeInTheDocument();
    expect(screen.getByTestId("add-agent-inline-auth-fallback-0-google")).toBeInTheDocument();
    expect(screen.getByTestId("add-agent-provider-auth-openai")).toBeInTheDocument();
    expect(screen.getByTestId("add-agent-provider-auth-google")).toBeInTheDocument();
    expect(screen.getByTestId("add-agent-auth-method-openai-openai-codex")).toBeInTheDocument();
    expect(screen.getByTestId("add-agent-auth-method-google-google-gemini-cli")).toBeInTheDocument();
  });

  it("defers OAuth until Add Agent and submits the remapped provider-specific model", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onProviderAuthChange = vi.fn().mockResolvedValue(undefined);
    const onStartOAuth = vi.fn().mockResolvedValue({
      ...defaultProviderAuths.openai,
      auth_method: "openai-codex",
      profile_key: "openai-codex-profile",
      oauth_provider_id: "openai-codex",
    });

    render(
      <AddAgentModal
        onClose={vi.fn()}
        onSubmit={onSubmit}
        providerAuths={defaultProviderAuths}
        onProviderAuthChange={onProviderAuthChange}
        onStartOAuth={onStartOAuth}
        onDetectLocalModels={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Model" }));
    await user.click(screen.getByTestId("add-agent-primary-provider").querySelector("button")!);
    await user.click(screen.getAllByText("OpenAI").at(-1)!);
    await user.click(screen.getByTestId("add-agent-auth-method-openai-openai-codex"));

    expect(screen.getByTestId("add-agent-oauth-deferred-openai")).toHaveTextContent(
      "OAuth will open after you click Add Agent.",
    );
    expect(onStartOAuth).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Add Agent" }));

    expect(onProviderAuthChange).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({
        auth_method: "openai-codex",
        oauth_provider_id: "openai-codex",
      }),
    );
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "openai-codex/gpt-5.4",
      }),
    );
    expect(onStartOAuth).toHaveBeenCalledWith("openai", "openai-codex", "openai-codex");
    expect(onProviderAuthChange.mock.invocationCallOrder[0]).toBeLessThan(
      onSubmit.mock.invocationCallOrder[0],
    );
    expect(onSubmit.mock.invocationCallOrder[0]).toBeLessThan(
      onStartOAuth.mock.invocationCallOrder[0],
    );
  });

  it("blocks Add Agent when the selected provider is missing auth and oauth cannot be launched", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <AddAgentModal
        onClose={vi.fn()}
        onSubmit={onSubmit}
        providerAuths={defaultProviderAuths}
        onProviderAuthChange={vi.fn()}
        onDetectLocalModels={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Model" }));
    await user.click(screen.getByTestId("add-agent-primary-provider").querySelector("button")!);
    await user.click(screen.getAllByText("Google").at(-1)!);

    expect(screen.getByTestId("add-agent-missing-provider-auth-error")).toHaveTextContent(
      "Missing authentication for google.",
    );
    expect(screen.getByRole("button", { name: "Add Agent" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("deduplicates inline auth blocks for repeated providers and hides them when credentials already exist", async () => {
    const user = userEvent.setup();
    render(
      <AddAgentModal
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        providerAuths={{
          ...defaultProviderAuths,
          google: {
            ...defaultProviderAuths.google,
            token: "already-set",
          },
        }}
        onProviderAuthChange={vi.fn()}
        onStartOAuth={vi.fn()}
        onDetectLocalModels={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Model" }));
    await user.click(screen.getByTestId("add-agent-primary-provider").querySelector("button")!);
    await user.click(screen.getAllByText("OpenAI").at(-1)!);

    await user.click(screen.getByRole("button", { name: "+ Add fallback" }));
    await user.click(screen.getByTestId("add-agent-fallback-provider-0").querySelector("button")!);
    await user.click(screen.getAllByText("OpenAI").at(-1)!);

    await user.click(screen.getByRole("button", { name: "+ Add fallback" }));
    await user.click(screen.getByTestId("add-agent-fallback-provider-1").querySelector("button")!);
    await user.click(screen.getAllByText("Google").at(-1)!);

    expect(screen.getByTestId("add-agent-inline-auth-primary-openai")).toBeInTheDocument();
    expect(screen.queryByTestId("add-agent-inline-auth-fallback-0-openai")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-agent-inline-auth-fallback-1-google")).not.toBeInTheDocument();
  });

  it("renders the full skills catalog and the real tools editor", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByText("1Password")).toBeInTheDocument();
    expect(screen.getByText("Gemini CLI")).toBeInTheDocument();
    expect(screen.getByTestId("add-agent-skill-1password")).toHaveClass("!justify-start");
    expect(screen.getByTestId("add-agent-skill-1password")).toHaveClass("!items-start");

    await user.click(screen.getByRole("tab", { name: "Tools" }));
    expect(screen.getByText("Tool Access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable All" })).toBeInTheDocument();
  });

  it("keeps a fixed shell structure while switching tabs", async () => {
    const user = userEvent.setup();
    renderModal();

    const modal = screen.getByTestId("add-agent-modal");
    expect(modal).toHaveStyle({ height: "min(860px, calc(100vh - 2rem))" });
    expect(screen.getByRole("button", { name: "Add Agent" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Advanced" }));

    expect(screen.getByTestId("add-agent-modal")).toHaveStyle({
      height: "min(860px, calc(100vh - 2rem))",
    });
    expect(screen.getByRole("button", { name: "Add Agent" })).toBeInTheDocument();
  });
});
