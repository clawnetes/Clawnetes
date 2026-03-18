import { test, expect } from "@playwright/test";
import { injectIpcBridge } from "../helpers/ipc-bridge";
import { loadE2EConfig, E2EConfig } from "../helpers/env-config";
import { startBridgeServer, BridgeServer } from "../helpers/bridge-server";
import {
  clickTestId,
  fillInput,
  waitForText,
  waitForTestId,
  selectModeCard,
  selectDropdown,
} from "../helpers/wizard-actions";

// Provider value → dropdown label mapping
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  xai: "xAI (Grok)",
  ollama: "Ollama (Local)",
  lmstudio: "LM Studio (Local)",
  local: "Custom Local Endpoint",
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

let config: E2EConfig;
let bridge: BridgeServer;

test.describe.serial("Real Deployment", () => {
  test.beforeAll(async () => {
    config = loadE2EConfig();
    bridge = await startBridgeServer();

    // Clean slate — uninstall if previously installed
    try {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "uninstall_openclaw", args: {} }),
      });
      await response.json();
    } catch {
      // Ignore — may not be installed
    }
  });

  test.beforeEach(async ({ page }) => {
    await injectIpcBridge(page, bridge.port);
    await page.goto("/");
  });

  test("full wizard deploy and verify", async ({ page }) => {
    // Step 0.5: Welcome
    await waitForTestId(page, "step-welcome");
    await clickTestId(page, "btn-start-setup");

    // Step 1: Environment
    await waitForTestId(page, "step-environment");
    await selectModeCard(page, "Local");
    await clickTestId(page, "btn-continue");

    // Step 2: System Check (REAL checks — wait longer)
    await waitForTestId(page, "step-system-check");
    await expect(page.getByText("Node.js")).toBeVisible({ timeout: 15_000 });
    // Wait for continue button to be enabled (checks complete)
    await page
      .locator('[data-testid="btn-continue"]:not([disabled])')
      .click({ timeout: 30_000 });

    // Step 3: Security
    await waitForTestId(page, "step-security");
    await clickTestId(page, "btn-i-understand");

    // Step 5: Identity
    await waitForTestId(page, "step-identity");
    await fillInput(page, "input-user-name", config.userName);
    await clickTestId(page, "btn-next");

    // Step 6: Agent Profile
    await waitForTestId(page, "step-agent-profile");
    await fillInput(page, "input-agent-name", config.agentName);
    await clickTestId(page, "btn-next");

    // Step 6.5: Agent Type
    await waitForTestId(page, "step-agent-type");
    await clickTestId(page, "btn-next");

    // Step 8: Connect Brain
    await waitForTestId(page, "step-connect-brain");

    // Select provider
    const providerLabel = PROVIDER_LABELS[config.aiProvider] || config.aiProvider;
    await selectDropdown(page, '[data-testid="dropdown-provider"]', providerLabel);

    // Fill API key
    await page.locator('[data-testid="input-api-key"]').fill(config.apiKey);

    // Select model — find the option that contains the model name
    // The model dropdown may show a display label, so click the dropdown and find matching option
    const modelDropdown = page.locator('[data-testid="dropdown-model"]');
    await modelDropdown.locator(".dropdown-trigger").click();
    // Try to find the model by its value text or label
    const modelOption = page
      .locator(".dropdown-option")
      .filter({ hasText: new RegExp(config.model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
    const modelCount = await modelOption.count();
    if (modelCount > 0) {
      await modelOption.first().click();
    } else {
      // If not found in list, close dropdown (model may already be selected)
      await modelDropdown.locator(".dropdown-trigger").click();
    }

    await clickTestId(page, "btn-next");

    // Step 9: Channels
    await waitForTestId(page, "step-channels");

    // Select channel
    const channelLabel = CHANNEL_LABELS[config.messagingChannel] || config.messagingChannel;
    await selectDropdown(page, '[data-testid="dropdown-channel"]', channelLabel);

    // Fill channel-specific fields
    if (config.messagingChannel === "telegram" && config.telegramBotToken) {
      await fillInput(page, "input-telegram-token", config.telegramBotToken);
    }
    if (config.messagingChannel === "whatsapp" && config.whatsappPhone) {
      await fillInput(page, "input-whatsapp-phone", config.whatsappPhone);
    }

    await clickTestId(page, "btn-next");

    // Step 16: Review & Deploy
    await waitForTestId(page, "step-review");
    await waitForText(page, "Deploy Your AI Agent");
    await clickTestId(page, "btn-finish-setup");

    // REAL deployment — wait up to 5 minutes
    await waitForTestId(page, "step-complete", 300_000);
    await waitForText(page, "Setup Complete!", 300_000);

    // Verify dashboard button exists and click it
    await waitForTestId(page, "btn-open-dashboard");
    await clickTestId(page, "btn-open-dashboard");

    // Verify dashboard is actually accessible
    const dashboardResponse = await page.request.get("http://127.0.0.1:18789");
    expect(dashboardResponse.ok()).toBeTruthy();

    // Navigate to dashboard and verify it renders
    await page.goto("http://127.0.0.1:18789");
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    await expect(page.locator("body")).not.toBeEmpty();

    // Give time to see the dashboard before the test suite tears it down
    await page.waitForTimeout(15_000);
  });

  test("dashboard is accessible after deploy", async ({ page }) => {
    // Retry/poll for up to 30s in case gateway is still starting
    const maxWait = 30_000;
    const start = Date.now();
    let lastError: Error | null = null;
    while (Date.now() - start < maxWait) {
      try {
        const response = await page.request.get("http://127.0.0.1:18789");
        expect(response.ok()).toBeTruthy();
        lastError = null;
        break;
      } catch (err) {
        lastError = err as Error;
        await page.waitForTimeout(2_000);
      }
    }
    if (lastError) throw lastError;
  });

  test("shows maintenance screen on reopen", async ({ page }) => {
    // Navigate to / again (simulates app reopen)
    await page.goto("/");

    // App starts at Welcome page — navigate through to trigger maintenance redirect
    await waitForTestId(page, "step-welcome");
    await clickTestId(page, "btn-start-setup");

    // Select Local environment — this triggers checkSystem(false) which
    // detects openclaw is already installed and redirects to maintenance
    await waitForTestId(page, "step-environment");
    await selectModeCard(page, "Local");
    await clickTestId(page, "btn-continue");

    // Should redirect to maintenance screen instead of system check
    await waitForText(page, "Welcome Back");
    await waitForText(page, "Open Dashboard");
  });

  test.afterAll(async () => {
    if (!bridge) return;

    // Cleanup: uninstall OpenClaw
    try {
      await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "uninstall_openclaw", args: {} }),
      });
    } catch {
      // Best effort cleanup
    }

    bridge.close();
  });
});
