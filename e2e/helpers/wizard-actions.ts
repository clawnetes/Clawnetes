import { Page, expect } from "@playwright/test";

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
export async function waitForText(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 10000 });
}

/**
 * Wait for a data-testid element to be visible.
 */
export async function waitForTestId(page: Page, testId: string): Promise<void> {
  await expect(page.locator(`[data-testid="${testId}"]`)).toBeVisible({ timeout: 10000 });
}

/**
 * Click a mode card by its label text.
 */
export async function selectModeCard(page: Page, labelText: string): Promise<void> {
  await page.locator(".mode-card", { hasText: labelText }).click();
}
