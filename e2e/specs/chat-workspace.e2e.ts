import { test, expect } from "@playwright/test";
import { injectIpcBridge } from "../helpers/ipc-bridge";
import { startBridgeServer, type BridgeServer } from "../helpers/bridge-server";
import { waitForText } from "../helpers/wizard-actions";

test.describe.serial("Installed Chat Workspace", () => {
  let bridge: BridgeServer;

  test.beforeAll(async () => {
    bridge = await startBridgeServer();
  });

  test.beforeEach(async ({ page }) => {
    await injectIpcBridge(page, bridge.port);
  });

  test.afterAll(async () => {
    bridge.close();
  });

  test("connects to the gateway and enables chat actions", async ({ page }) => {
    await page.goto("/");
    await waitForText(page, "Agent Workspace", 30_000);

    const activeAgent = page.locator('[data-testid="chat-active-agent"]');
    await expect(activeAgent).not.toHaveText(/Connecting to gateway|No agents available/i, {
      timeout: 30_000,
    });

    await expect(page.locator('[data-testid="chat-new-session"]')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('[data-testid="chat-composer"]')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('[data-testid="chat-error-state"]')).toHaveCount(0);
  });

  test("creates a new session and submits a message", async ({ page }) => {
    await page.goto("/");
    await waitForText(page, "Agent Workspace", 30_000);

    const newChatButton = page.locator('[data-testid="chat-new-session"]');
    await expect(newChatButton).toBeEnabled({ timeout: 30_000 });
    await newChatButton.click();

    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeEnabled({ timeout: 30_000 });
    await composer.fill("Hello from the Playwright validation.");

    const sendButton = page.locator('[data-testid="chat-send"]');
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(page.getByText("Hello from the Playwright validation.").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="chat-error-state"]')).toHaveCount(0);
  });
});
