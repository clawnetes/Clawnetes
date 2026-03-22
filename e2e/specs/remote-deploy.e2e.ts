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
  fillWizardSecurityToChannels,
} from "../helpers/wizard-actions";

let config: E2EConfig;
let bridge: BridgeServer;

test.describe.serial("Remote Deployment", () => {
  test.beforeAll(async () => {
    config = loadE2EConfig();

    if (config.deployTarget !== "remote") {
      test.skip();
      return;
    }

    bridge = await startBridgeServer();

    // Clean slate — uninstall any previous remote install
    try {
      await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "uninstall_remote_openclaw",
          args: {
            remote: {
              ip: config.remoteIp,
              user: config.remoteUser,
              password: config.remotePassword || null,
              privateKeyPath: config.remoteSshKey || null,
            },
          },
        }),
      });
    } catch {
      // Ignore — may not be installed
    }

    // Stop any lingering tunnel
    try {
      await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "stop_ssh_tunnel", args: {} }),
      });
    } catch {
      // Ignore
    }
  });

  test.beforeEach(async ({ page }) => {
    test.skip(config.deployTarget !== "remote", "DEPLOY_TARGET is not remote");
    await injectIpcBridge(page, bridge.port);
    await page.goto("/");
  });

  test("full remote wizard deploy and verify", async ({ page }) => {
    // Step 0.5: Welcome
    await waitForTestId(page, "step-welcome");
    await clickTestId(page, "btn-start-setup");

    // Step 1: Environment — select Cloud Server
    await waitForTestId(page, "step-environment");
    await selectModeCard(page, "Cloud Server");

    // Fill SSH configuration
    await fillInput(page, "input-remote-ip", config.remoteIp!);
    await fillInput(page, "input-remote-user", config.remoteUser!);
    if (config.remoteSshKey) {
      await fillInput(page, "input-remote-key", config.remoteSshKey);
    }
    if (config.remotePassword) {
      await fillInput(page, "input-remote-password", config.remotePassword);
    }

    // Test SSH connection
    await clickTestId(page, "btn-test-connection");
    await waitForText(page, "SSH connection established successfully", 30_000);

    await clickTestId(page, "btn-continue");

    // Step 2: System Check (remote — shows IP)
    await waitForTestId(page, "step-system-check");
    await waitForText(page, config.remoteIp!, 15_000);
    await page
      .locator('[data-testid="btn-continue"]:not([disabled])')
      .click({ timeout: 60_000 });

    // Steps 3-9: Security → Identity → Agent → Brain → Channels (shared)
    await fillWizardSecurityToChannels(page, config);

    // Step 16: Review & Deploy (triggers setup_remote_openclaw + start_ssh_tunnel)
    await waitForTestId(page, "step-review");
    await waitForText(page, "Deploy Your AI Agent");
    await clickTestId(page, "btn-finish-setup");

    // REMOTE deployment — wait up to 5 minutes
    await waitForTestId(page, "step-complete", 300_000);
    await waitForText(page, "Setup Complete!", 300_000);

    // Verify dashboard button exists and click it
    await waitForTestId(page, "btn-open-dashboard");
    await clickTestId(page, "btn-open-dashboard");

    // Get the tokenized dashboard URL from the bridge (remote)
    const urlRes = await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "get_dashboard_url",
        args: {
          isRemote: true,
          remote: {
            ip: config.remoteIp,
            user: config.remoteUser,
            password: config.remotePassword || null,
            privateKeyPath: config.remoteSshKey || null,
          },
        },
      }),
    });
    const { result: dashboardUrl } = await urlRes.json();
    console.log("[test] remote dashboard URL:", dashboardUrl);

    // Verify dashboard is accessible through the tunnel
    const dashboardResponse = await page.request.get("http://127.0.0.1:28789");
    expect(dashboardResponse.ok()).toBeTruthy();

    // Navigate to tokenized dashboard URL
    await page.goto(dashboardUrl);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    await page.screenshot({ path: "test-results/remote-dashboard.png", fullPage: true });

    // Check for errors
    const bodyText = await page.locator("body").innerText();
    console.log("[dashboard] body text preview:", bodyText.slice(0, 500));
    const hasAuthError = /unauthorized|forbidden|auth|login|401|403/i.test(bodyText);
    const hasServerError = /500|502|503|internal server error|bad gateway/i.test(bodyText);
    expect(hasAuthError, `Dashboard shows auth error: ${bodyText.slice(0, 200)}`).toBeFalsy();
    expect(hasServerError, `Dashboard shows server error: ${bodyText.slice(0, 200)}`).toBeFalsy();
    await expect(page.locator("body")).not.toBeEmpty();

    await page.waitForTimeout(5_000);
  });

  test("dashboard accessible through tunnel", async ({ page }) => {
    const maxWait = 30_000;
    const start = Date.now();
    let lastError: Error | null = null;
    while (Date.now() - start < maxWait) {
      try {
        const response = await page.request.get("http://127.0.0.1:28789");
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

  test("send message via remote dashboard chat", async ({ page }) => {
    // Get tokenized dashboard URL
    const urlRes = await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "get_dashboard_url",
        args: {
          isRemote: true,
          remote: {
            ip: config.remoteIp,
            user: config.remoteUser,
            password: config.remotePassword || null,
            privateKeyPath: config.remoteSshKey || null,
          },
        },
      }),
    });
    const { result: dashboardUrl } = await urlRes.json();
    console.log("[test] navigating to remote dashboard:", dashboardUrl);

    await page.goto(dashboardUrl);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // Verify no errors
    const bodyText = await page.locator("body").innerText();
    const hasAuthError = /unauthorized|forbidden|401|403/i.test(bodyText);
    const hasServerError = /500|502|503|internal server error|bad gateway/i.test(bodyText);
    expect(hasAuthError, `Dashboard shows auth error: ${bodyText.slice(0, 200)}`).toBeFalsy();
    expect(hasServerError, `Dashboard shows server error: ${bodyText.slice(0, 200)}`).toBeFalsy();

    // Find chat input and send message
    const chatInput = page.getByPlaceholder(/Message.*Enter to send/i);
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    await chatInput.fill("Hello, what is your name?");
    await chatInput.press("Enter");

    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "test-results/remote-chat-sent.png", fullPage: true });

    // Wait for assistant response (up to 2 minutes)
    let gotResponse = false;
    const maxWait = 120_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const chatArea = await page.locator("body").innerText();
      const afterUserMsg = chatArea.split("Hello, what is your name?").pop() || "";
      const staticTexts = [
        "Ready to chat", "Type a message", "Enter to send", "for commands",
        "What can you do", "Summarize my recent sessions", "Help me configure",
        "Check system health", `Message ${config.agentName}`,
      ];
      let responseContent = afterUserMsg;
      for (const t of staticTexts) {
        responseContent = responseContent.replace(new RegExp(t, "gi"), "");
      }
      responseContent = responseContent.replace(/\s+/g, " ").trim();

      if (responseContent.length > 20) {
        console.log("[test] assistant response detected:", responseContent.slice(0, 300));
        const isAgentError = /agent failed|no api key|auth.*error|failed before reply/i.test(responseContent);
        expect(isAgentError, `Agent error in chat: ${responseContent.slice(0, 300)}`).toBeFalsy();
        gotResponse = true;
        break;
      }

      await page.waitForTimeout(3_000);
    }

    await page.screenshot({ path: "test-results/remote-chat-response.png", fullPage: true });
    expect(gotResponse, "Expected assistant to respond within 2 minutes").toBeTruthy();
  });

  test("reopens into chat after the remote environment is confirmed", async ({ page }) => {
    await page.goto("/");

    await waitForTestId(page, "step-welcome");
    await clickTestId(page, "btn-start-setup");

    // Select Cloud Server, then explicitly continue into the installed remote workspace.
    await waitForTestId(page, "step-environment");
    await selectModeCard(page, "Cloud Server");

    // Fill SSH config and test connection
    await fillInput(page, "input-remote-ip", config.remoteIp!);
    await fillInput(page, "input-remote-user", config.remoteUser!);
    if (config.remoteSshKey) {
      await fillInput(page, "input-remote-key", config.remoteSshKey);
    }
    if (config.remotePassword) {
      await fillInput(page, "input-remote-password", config.remotePassword);
    }
    await clickTestId(page, "btn-test-connection");
    await waitForText(page, "SSH connection established successfully", 30_000);

    await clickTestId(page, "btn-continue");

    await waitForText(page, "Agent Workspace", 30_000);
  });

  test.afterAll(async () => {
    if (!bridge) return;

    // Stop SSH tunnel
    try {
      await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "stop_ssh_tunnel", args: {} }),
      });
    } catch {
      // Best effort
    }

    // Uninstall remote OpenClaw
    try {
      await fetch(`http://127.0.0.1:${bridge.port}/ipc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "uninstall_remote_openclaw",
          args: {
            remote: {
              ip: config.remoteIp,
              user: config.remoteUser,
              password: config.remotePassword || null,
              privateKeyPath: config.remoteSshKey || null,
            },
          },
        }),
      });
    } catch {
      // Best effort cleanup
    }

    bridge.close();
  });
});
