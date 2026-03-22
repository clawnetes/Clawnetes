import { test, expect } from "@playwright/test";
import { injectIpcBridge } from "../helpers/ipc-bridge";
import { loadE2EConfig, E2EConfig } from "../helpers/env-config";
import { startBridgeServer, BridgeServer } from "../helpers/bridge-server";
import {
  clickTestId,
  waitForText,
  waitForTestId,
  selectModeCard,
  fillWizardSecurityToChannels,
} from "../helpers/wizard-actions";

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

    // Steps 3-9: Security → Identity → Agent → Brain → Channels (shared)
    await fillWizardSecurityToChannels(page, config);

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

    // Get the tokenized dashboard URL from the bridge
    const urlRes = await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "get_dashboard_url", args: { isRemote: false, remote: null } }),
    });
    const { result: dashboardUrl } = await urlRes.json();
    console.log("[test] dashboard URL:", dashboardUrl);

    // Verify dashboard is actually accessible
    const dashboardResponse = await page.request.get("http://127.0.0.1:18789");
    expect(dashboardResponse.ok()).toBeTruthy();

    // Navigate to tokenized dashboard URL and verify it renders without errors
    await page.goto(dashboardUrl);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });

    // Check for common error indicators
    const bodyText = await page.locator("body").innerText();
    console.log("[dashboard] body text preview:", bodyText.slice(0, 500));

    const hasAuthError = /unauthorized|forbidden|auth|login|401|403/i.test(bodyText);
    const hasServerError = /500|502|503|internal server error|bad gateway/i.test(bodyText);
    expect(hasAuthError, `Dashboard shows auth error: ${bodyText.slice(0, 200)}`).toBeFalsy();
    expect(hasServerError, `Dashboard shows server error: ${bodyText.slice(0, 200)}`).toBeFalsy();
    await expect(page.locator("body")).not.toBeEmpty();

    // Give time to see the dashboard before moving on
    await page.waitForTimeout(5_000);
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

  test("send message via dashboard chat and get response", async ({ page }) => {
    // Get tokenized dashboard URL
    const urlRes = await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "get_dashboard_url", args: { isRemote: false, remote: null } }),
    });
    const { result: dashboardUrl } = await urlRes.json();
    console.log("[test] navigating to dashboard:", dashboardUrl);

    // Navigate to dashboard
    await page.goto(dashboardUrl);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // Verify no auth/server errors on load
    const bodyText = await page.locator("body").innerText();
    const hasAuthError = /unauthorized|forbidden|401|403/i.test(bodyText);
    const hasServerError = /500|502|503|internal server error|bad gateway/i.test(bodyText);
    expect(hasAuthError, `Dashboard shows auth error: ${bodyText.slice(0, 200)}`).toBeFalsy();
    expect(hasServerError, `Dashboard shows server error: ${bodyText.slice(0, 200)}`).toBeFalsy();

    // The dashboard opens directly to the Chat page with an input at the bottom.
    // Find the message input by its placeholder text.
    const chatInput = page.getByPlaceholder(/Message.*Enter to send/i);
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    // Type a message and send with Enter
    await chatInput.fill("Hello, what is your name?");
    await chatInput.press("Enter");

    // Take a screenshot right after sending
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "test-results/dashboard-chat-sent.png", fullPage: true });

    // Wait for assistant response — look for a new message bubble that is NOT our user message.
    // The dashboard renders messages in the chat area. Wait for any response content
    // to appear (up to 2 minutes for LLM to respond).
    // We watch for a response by waiting for text that wasn't there before.
    const responseLocator = page.locator("[class*='assistant'], [class*='response'], [class*='message']")
      .filter({ hasNotText: "Hello, what is your name?" })
      .filter({ hasNotText: "Ready to chat" })
      .filter({ hasNotText: "Type a message" });

    // Also try: wait for any new content to appear after the quick-action chips disappear
    // or for a streaming response indicator
    let gotResponse = false;
    const maxWait = 120_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      // Check for error indicators
      const bodyText = await page.locator("body").innerText();
      const hasError = /error|failed|exception|unauthorized|forbidden/i.test(
        bodyText.replace(/error-context|error-boundary|check system health/gi, "")
      );

      // Look for signs of a response: streaming dots, new message content, etc.
      // The agent name or any substantial new text appearing after our message indicates a response
      const chatArea = await page.locator("body").innerText();
      const afterUserMsg = chatArea.split("Hello, what is your name?").pop() || "";
      // Filter out static UI text to find actual response content
      const staticTexts = [
        "Ready to chat", "Type a message", "Enter to send", "for commands",
        "What can you do", "Summarize my recent sessions", "Help me configure",
        "Check system health", "Message TestAgent",
      ];
      let responseContent = afterUserMsg;
      for (const t of staticTexts) {
        responseContent = responseContent.replace(new RegExp(t, "gi"), "");
      }
      responseContent = responseContent.replace(/\s+/g, " ").trim();

      if (responseContent.length > 20) {
        console.log("[test] assistant response detected:", responseContent.slice(0, 300));

        // Fail if the response is an agent error (e.g. missing API key)
        const isAgentError = /agent failed|no api key|auth.*error|failed before reply/i.test(responseContent);
        expect(isAgentError, `Agent error in chat response: ${responseContent.slice(0, 300)}`).toBeFalsy();

        gotResponse = true;
        break;
      }

      await page.waitForTimeout(3_000);
    }

    // Final screenshot
    await page.screenshot({ path: "test-results/dashboard-chat-response.png", fullPage: true });

    // Check for errors in the page
    const finalBody = await page.locator("body").innerText();
    const chatErrors = finalBody.match(/error[:\s].{0,100}/gi) || [];
    const realErrors = chatErrors.filter(
      (e) => !/error-context|error-boundary|check system health/i.test(e)
    );
    if (realErrors.length > 0) {
      console.error("[test] errors found on page:", realErrors);
    }

    expect(gotResponse, "Expected assistant to respond to chat message within 2 minutes").toBeTruthy();
  });

  test("shows the Clawnetes chat workspace on reopen", async ({ page }) => {
    await page.goto("/");
    await waitForText(page, "Agent Workspace", 30_000);
    await expect(page.locator('[data-testid="chat-active-agent"]')).not.toHaveText(/No agents available|Connecting to gateway/i, {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="chat-new-session"]')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('[data-testid="chat-composer"]')).toBeEnabled({ timeout: 30_000 });
  });

  test("can create a new Clawnetes chat session and submit a message", async ({ page }) => {
    await page.goto("/");
    await waitForText(page, "Agent Workspace", 30_000);
    await expect(page.locator('[data-testid="chat-active-agent"]')).not.toHaveText(/No agents available|Connecting to gateway/i, {
      timeout: 30_000,
    });

    const newChatButton = page.locator('[data-testid="chat-new-session"]');
    await expect(newChatButton).toBeEnabled({ timeout: 30_000 });
    await newChatButton.click();

    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeEnabled({ timeout: 30_000 });
    await composer.fill("Hello from Clawnetes.");

    const sendButton = page.locator('[data-testid="chat-send"]');
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(page.getByText("Hello from Clawnetes.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="chat-error-state"]')).toHaveCount(0);
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
