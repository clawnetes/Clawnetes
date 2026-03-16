import { injectIpcMocks } from "../helpers/ipc-mock";
import {
  clickButton,
  clickTestId,
  fillInput,
  waitForText,
  waitForTestId,
  selectModeCard,
} from "../helpers/wizard-actions";

describe("Wizard Happy Path", () => {
  beforeEach(async () => {
    // Inject IPC mocks before each test so Tauri commands return canned data
    await injectIpcMocks();
  });

  it("should walk through the full wizard setup flow", async () => {
    // Step 0.5: Welcome
    await waitForTestId("step-welcome");
    await waitForText("Welcome to Clawnetes");
    await clickTestId("btn-start-setup");

    // Step 1: Environment — select Local
    await waitForTestId("step-environment");
    await waitForText("Target Environment");
    await selectModeCard("Local");
    await clickTestId("btn-continue");

    // Step 2: System Check — prerequisites are mocked as passing
    await waitForTestId("step-system-check");
    await waitForText("System Check");
    await clickTestId("btn-continue");

    // Step 3: Security Baseline
    await waitForTestId("step-security");
    await waitForText("Security Baseline");
    await clickTestId("btn-i-understand");

    // Step 5: Identity — enter user name
    await waitForTestId("step-identity");
    await waitForText("Your Identity");
    await fillInput("input-user-name", "TestUser");
    await clickTestId("btn-next");

    // Step 6: Agent Profile — enter agent name
    await waitForTestId("step-agent-profile");
    await waitForText("Agent Profile");
    await fillInput("input-agent-name", "TestAgent");
    await clickTestId("btn-next");

    // Step 6.5: Agent Type — select default (Custom) and continue
    await waitForTestId("step-agent-type");
    await waitForText("Agent Type");
    await clickTestId("btn-next");

    // Step 8: Connect Brain — enter API key
    await waitForTestId("step-connect-brain");
    await waitForText("Connect Brain");
  });
});

describe("Welcome Page", () => {
  beforeEach(async () => {
    await injectIpcMocks();
  });

  it("should display the welcome title and Start Setup button", async () => {
    await waitForTestId("step-welcome");
    const title = await $(".welcome-title");
    const titleText = await title.getText();
    expect(titleText).toContain("Welcome to Clawnetes");

    const startBtn = await $('[data-testid="btn-start-setup"]');
    expect(await startBtn.isDisplayed()).toBe(true);
  });
});

describe("Environment Selection", () => {
  beforeEach(async () => {
    await injectIpcMocks();
  });

  it("should show Local and Cloud options", async () => {
    await waitForTestId("step-welcome");
    await clickTestId("btn-start-setup");

    await waitForTestId("step-environment");
    await waitForText("Local");
    await waitForText("Cloud");
  });
});
