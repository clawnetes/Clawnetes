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

test.describe("Wizard Happy Path", () => {
  test("walks through the full wizard setup flow", async ({ page }) => {
    // Step 0.5: Welcome
    await waitForTestId(page, "step-welcome");
    await waitForText(page, "Welcome to Clawnetes");
    await clickTestId(page, "btn-start-setup");

    // Step 1: Environment — select Local
    await waitForTestId(page, "step-environment");
    await waitForText(page, "Target Environment");
    await selectModeCard(page, "Local");
    await clickTestId(page, "btn-continue");

    // Step 2: System Check — prerequisites are mocked as passing
    await waitForTestId(page, "step-system-check");
    await waitForText(page, "System Check");
    await clickTestId(page, "btn-continue");

    // Step 3: Security Baseline
    await waitForTestId(page, "step-security");
    await waitForText(page, "Security Baseline");
    await clickTestId(page, "btn-i-understand");

    // Step 5: Identity — enter user name
    await waitForTestId(page, "step-identity");
    await waitForText(page, "Your Identity");
    await fillInput(page, "input-user-name", "TestUser");
    await clickTestId(page, "btn-next");

    // Step 6: Agent Profile — enter agent name
    await waitForTestId(page, "step-agent-profile");
    await waitForText(page, "Agent Profile");
    await fillInput(page, "input-agent-name", "TestAgent");
    await clickTestId(page, "btn-next");

    // Step 6.5: Agent Type — select default (Custom) and continue
    await waitForTestId(page, "step-agent-type");
    await waitForText(page, "Agent Type");
    await clickTestId(page, "btn-next");

    // Step 8: Connect Brain — verify we arrived
    await waitForTestId(page, "step-connect-brain");
    await waitForText(page, "Connect Brain");
  });
});

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
