import { test, expect } from "@playwright/test";
import { injectIpcMocks } from "../helpers/ipc-mock";
import {
  clickTestId,
  fillInput,
  waitForText,
  waitForTestId,
  selectModeCard,
} from "../helpers/wizard-actions";

test.beforeEach(async ({ page }) => {
  await injectIpcMocks(page);
  await page.goto("/");
});

// ---------------------------------------------------------------------------
// Helper: navigate through common steps (Welcome → Channels)
// ---------------------------------------------------------------------------
async function navigateToChannels(page: import("@playwright/test").Page) {
  // Welcome
  await waitForTestId(page, "step-welcome");
  await clickTestId(page, "btn-start-setup");

  // Environment
  await waitForTestId(page, "step-environment");
  await selectModeCard(page, "Local");
  await clickTestId(page, "btn-continue");

  // System Check
  await waitForTestId(page, "step-system-check");
  await clickTestId(page, "btn-continue");

  // Security
  await waitForTestId(page, "step-security");
  await clickTestId(page, "btn-i-understand");

  // Identity
  await waitForTestId(page, "step-identity");
  await fillInput(page, "input-user-name", "TestUser");
  await clickTestId(page, "btn-next");

  // Agent Profile
  await waitForTestId(page, "step-agent-profile");
  await fillInput(page, "input-agent-name", "TestAgent");
  await clickTestId(page, "btn-next");

  // Agent Type (Custom selected by default)
  await waitForTestId(page, "step-agent-type");
  await clickTestId(page, "btn-next");

  // Connect Brain
  await waitForTestId(page, "step-connect-brain");
  await waitForText(page, "Connect Brain");
  await waitForText(page, "AI Provider");
  await waitForText(page, "Primary Model");
  await clickTestId(page, "btn-next");

  // Channels
  await waitForTestId(page, "step-channels");
}

// ---------------------------------------------------------------------------
// Basic flow: Welcome → Deploy → Setup Complete
// ---------------------------------------------------------------------------
test.describe("Basic Wizard Flow", () => {
  test("completes full basic setup through deploy", async ({ page }) => {
    await navigateToChannels(page);

    // Channels → Review (basic mode: "Next" goes to step 16)
    await clickTestId(page, "btn-next");

    // Review / Deploy
    await waitForTestId(page, "step-review");
    await waitForText(page, "Deploy Your AI Agent");

    // Click "Finish Setup" to trigger handleInstall
    await clickTestId(page, "btn-finish-setup");

    // Setup Complete
    await waitForTestId(page, "step-complete");
    await waitForText(page, "Setup Complete!");
    await waitForText(page, "Configuration Complete");
    await waitForText(page, "Open Web Dashboard");
    await waitForText(page, "Continue to Advanced Settings");
    await waitForText(page, "Exit Setup");
  });
});

// ---------------------------------------------------------------------------
// Advanced flow: Basic → Complete → Advanced Settings → all advanced steps
// ---------------------------------------------------------------------------
test.describe("Advanced Settings Flow", () => {
  test("navigates through all advanced settings steps", async ({ page }) => {
    // First go through the basic flow to reach Setup Complete
    await navigateToChannels(page);
    await clickTestId(page, "btn-next");

    // Review / Deploy
    await waitForTestId(page, "step-review");
    await clickTestId(page, "btn-finish-setup");

    // Setup Complete
    await waitForTestId(page, "step-complete");
    await waitForText(page, "Setup Complete!");

    // Click "Continue to Advanced Settings"
    await clickTestId(page, "btn-advanced-settings");

    // Personality (step 10.5)
    await waitForTestId(page, "step-personality");
    await waitForText(page, "personality");
    await clickTestId(page, "btn-next");

    // Model Configuration (step 13)
    await waitForTestId(page, "step-models");
    await waitForText(page, "Model Configuration");
    await waitForText(page, "Primary Model");
    await waitForText(page, "Fallback Models");
    await page.locator('[data-testid="btn-continue"]').click();

    // Skills (step 11)
    await waitForTestId(page, "step-skills");
    await waitForText(page, "skills");
    await page.locator('[data-testid="btn-continue"]').click();

    // Allowed Tools (step 11.1)
    await waitForTestId(page, "step-allowed-tools");
    await waitForText(page, "Tool Access");
    await clickTestId(page, "btn-next");

    // Business Functions (step 15)
    await waitForTestId(page, "step-business");
    await waitForText(page, "Build your AI powered business");
    await clickTestId(page, "btn-next");

    // Extra Settings (step 15.7)
    await waitForTestId(page, "step-extra-settings");
    await waitForText(page, "Extra Settings");
    await waitForText(page, "Gateway Settings");
    await waitForText(page, "Runtime Environment");
    await waitForText(page, "Security (Sandbox)");
    await waitForText(page, "Session Management");
    await clickTestId(page, "btn-next");

    // Review (step 16) — now in advanced mode
    await waitForTestId(page, "step-review");
  });
});

// ---------------------------------------------------------------------------
// Individual page tests
// ---------------------------------------------------------------------------
test.describe("Welcome Page", () => {
  test("displays the welcome title and Start Setup button", async ({ page }) => {
    await waitForTestId(page, "step-welcome");

    const title = page.locator(".welcome-title");
    await expect(title).toHaveText("Welcome to Clawnetes");

    const startBtn = page.locator('[data-testid="btn-start-setup"]');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toHaveText("Start Setup");
  });
});

test.describe("Environment Selection", () => {
  test("shows Local and Cloud options", async ({ page }) => {
    await clickTestId(page, "btn-start-setup");
    await waitForTestId(page, "step-environment");

    await expect(page.locator(".mode-card", { hasText: "Local" })).toBeVisible();
    await expect(page.locator(".mode-card", { hasText: "Cloud" })).toBeVisible();
  });
});
