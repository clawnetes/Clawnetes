import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StepComplete from "../StepComplete";
import { WizardContext } from "../../../context/WizardContext";
import { INITIAL_WIZARD_STATE } from "../../../hooks/useWizardState";
import type { DeferredOAuthItem } from "../../../utils/providerAuth";

vi.mock("../../../lib/tauri", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  openExternal: vi.fn(),
}));

function renderComplete(platform: "openclaw" | "hermes", deferredOAuthQueue: DeferredOAuthItem[] = []) {
  return render(
    <WizardContext.Provider
      value={{
        state: {
          ...INITIAL_WIZARD_STATE,
          platform,
          step: 17,
          messagingChannel: "none",
          dashboardUrl: platform === "hermes" ? "http://127.0.0.1:8642/v1" : "http://127.0.0.1:18789",
          gatewayPort: platform === "hermes" ? 8642 : 18789,
        },
        dispatch: vi.fn(),
      }}
    >
      <StepComplete
        handleToggleTunnel={vi.fn()}
        handlePairing={vi.fn()}
        handleAdvancedTransition={vi.fn()}
        runDeferredOAuthQueue={vi.fn()}
        deferredOAuthQueue={deferredOAuthQueue}
        onOpenWorkspace={vi.fn()}
      />
    </WizardContext.Provider>,
  );
}

describe("StepComplete", () => {
  it("renders a Hermes-specific completion screen without OpenClaw actions or copy", () => {
    renderComplete("hermes", [{
      id: "provider:openai",
      label: "OpenAI",
      targetProvider: "openai",
      authMethod: "openai-codex",
      oauthProviderId: "openai-codex",
      source: "provider",
      sourceId: "openai",
    }]);

    expect(screen.getByText(/Hermes Agent is running locally/i)).toBeInTheDocument();
    expect(screen.getByText("Hermes Configuration Complete")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:8642/v1")).toBeInTheDocument();
    expect(screen.getByText("hermes")).toBeInTheDocument();
    expect(screen.getByText("Deferred Hermes Agent Authentication")).toBeInTheDocument();

    expect(screen.queryByText(/OpenClaw/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Deferred OpenClaw Authentication/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Web Dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/donation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/openclaw tui/i)).not.toBeInTheDocument();
  });

  it("keeps OpenClaw completion actions on the OpenClaw path", () => {
    renderComplete("openclaw");

    expect(screen.getByText(/OpenClaw is running locally/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Web Dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/openclaw tui/i)).toBeInTheDocument();
  });
});
