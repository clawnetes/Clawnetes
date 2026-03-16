/**
 * Reusable helpers for navigating the wizard in E2E tests.
 */

/**
 * Click a button that contains the given text.
 */
export async function clickButton(text: string): Promise<void> {
  const btn = await $(`button=${text}`);
  await btn.waitForClickable({ timeout: 10000 });
  await btn.click();
}

/**
 * Click a button by data-testid.
 */
export async function clickTestId(testId: string): Promise<void> {
  const el = await $(`[data-testid="${testId}"]`);
  await el.waitForClickable({ timeout: 10000 });
  await el.click();
}

/**
 * Fill an input identified by data-testid with the given value.
 */
export async function fillInput(testId: string, value: string): Promise<void> {
  const input = await $(`[data-testid="${testId}"]`);
  await input.waitForExist({ timeout: 10000 });
  await input.setValue(value);
}

/**
 * Fill an input identified by placeholder text with the given value.
 */
export async function fillInputByPlaceholder(placeholder: string, value: string): Promise<void> {
  const input = await $(`input[placeholder="${placeholder}"]`);
  await input.waitForExist({ timeout: 10000 });
  await input.setValue(value);
}

/**
 * Wait for text to appear anywhere on the page.
 */
export async function waitForText(text: string, timeout = 10000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const body = await $("body");
      const pageText = await body.getText();
      return pageText.includes(text);
    },
    { timeout, timeoutMsg: `Text "${text}" not found within ${timeout}ms` }
  );
}

/**
 * Wait for an element with data-testid to exist.
 */
export async function waitForTestId(testId: string, timeout = 10000): Promise<void> {
  const el = await $(`[data-testid="${testId}"]`);
  await el.waitForExist({ timeout });
}

/**
 * Click a mode card by its label text. Mode cards are divs with class `.mode-card`.
 */
export async function selectModeCard(labelText: string): Promise<void> {
  const cards = await $$(".mode-card");
  for (const card of cards) {
    const text = await card.getText();
    if (text.includes(labelText)) {
      await card.click();
      return;
    }
  }
  throw new Error(`Mode card with text "${labelText}" not found`);
}
