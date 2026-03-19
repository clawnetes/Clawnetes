import { Page, expect } from "@playwright/test";
import type { E2EConfig } from "./env-config";

/**
 * Click a button by data-testid.
 */
export async function clickTestId(page: Page, testId: string): Promise<void> {
  await page.locator(`[data-testid="${testId}"]`).click();
}

/**
 * Fill an input by data-testid.
 */
export async function fillInput(page: Page, testId: string, value: string): Promise<void> {
  await page.locator(`[data-testid="${testId}"]`).fill(value);
}

/**
 * Wait for text to be visible on the page.
 */
export async function waitForText(page: Page, text: string, timeout = 10_000): Promise<void> {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout });
}

/**
 * Wait for a data-testid element to be visible.
 */
export async function waitForTestId(page: Page, testId: string, timeout = 10_000): Promise<void> {
  await expect(page.locator(`[data-testid="${testId}"]`)).toBeVisible({ timeout });
}

/**
 * Click a mode card by its label text.
 */
export async function selectModeCard(page: Page, labelText: string): Promise<void> {
  await page.locator(".mode-card", { hasText: labelText }).click();
}

/**
 * Select a value from a custom Dropdown component.
 * @param parentSelector - CSS selector for the dropdown container (e.g. '[data-testid="dropdown-provider"]')
 * @param label - Visible label text of the option to select
 */
export async function selectDropdown(page: Page, parentSelector: string, label: string): Promise<void> {
  const container = page.locator(parentSelector);
  await container.locator(".dropdown-trigger").click();
  await page.locator(".dropdown-option", { hasText: label }).click();
}

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

/**
 * Fill wizard steps from Security through Channels (steps 3-9).
 * Shared between local and remote deployment tests.
 */
export async function fillWizardSecurityToChannels(page: Page, config: E2EConfig): Promise<void> {
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

  // Select model
  const modelDropdown = page.locator('[data-testid="dropdown-model"]');
  await modelDropdown.locator(".dropdown-trigger").click();
  const modelOption = page
    .locator(".dropdown-option")
    .filter({ hasText: new RegExp(config.model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
  const modelCount = await modelOption.count();
  if (modelCount > 0) {
    await modelOption.first().click();
  } else {
    await modelDropdown.locator(".dropdown-trigger").click();
  }

  await clickTestId(page, "btn-next");

  // Step 9: Channels
  await waitForTestId(page, "step-channels");

  const channelLabel = CHANNEL_LABELS[config.messagingChannel] || config.messagingChannel;
  await selectDropdown(page, '[data-testid="dropdown-channel"]', channelLabel);

  if (config.messagingChannel === "telegram" && config.telegramBotToken) {
    await fillInput(page, "input-telegram-token", config.telegramBotToken);
  }
  if (config.messagingChannel === "whatsapp" && config.whatsappPhone) {
    await fillInput(page, "input-whatsapp-phone", config.whatsappPhone);
  }

  await clickTestId(page, "btn-next");
}
