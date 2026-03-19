/**
 * Centralized selectors for E2E tests.
 * Prefer data-testid attributes added in Step 7 of the implementation.
 */

// data-testid helper
export const testId = (id: string) => `[data-testid="${id}"]`;

// Step containers
export const STEP_WELCOME = testId("step-welcome");
export const STEP_ENVIRONMENT = testId("step-environment");
export const STEP_SYSTEM_CHECK = testId("step-system-check");
export const STEP_SECURITY = testId("step-security");
export const STEP_IDENTITY = testId("step-identity");
export const STEP_AGENT_PROFILE = testId("step-agent-profile");
export const STEP_AGENT_TYPE = testId("step-agent-type");
export const STEP_CONNECT_BRAIN = testId("step-connect-brain");
export const STEP_CHANNELS = testId("step-channels");

// Buttons
export const BTN_START_SETUP = testId("btn-start-setup");
export const BTN_CONTINUE = testId("btn-continue");
export const BTN_NEXT = testId("btn-next");
export const BTN_I_UNDERSTAND = testId("btn-i-understand");

// Inputs
export const INPUT_USER_NAME = testId("input-user-name");
export const INPUT_AGENT_NAME = testId("input-agent-name");
export const INPUT_API_KEY = testId("input-api-key");
export const INPUT_TELEGRAM_TOKEN = testId("input-telegram-token");
export const INPUT_WHATSAPP_PHONE = testId("input-whatsapp-phone");

// Dropdowns
export const DROPDOWN_PROVIDER = testId("dropdown-provider");
export const DROPDOWN_MODEL = testId("dropdown-model");
export const DROPDOWN_CHANNEL = testId("dropdown-channel");

// Additional steps
export const STEP_REVIEW = testId("step-review");
export const STEP_COMPLETE = testId("step-complete");

// Additional buttons
export const BTN_FINISH_SETUP = testId("btn-finish-setup");
export const BTN_ADVANCED_SETTINGS = testId("btn-advanced-settings");

// Remote/SSH inputs
export const INPUT_REMOTE_IP = testId("input-remote-ip");
export const INPUT_REMOTE_USER = testId("input-remote-user");
export const INPUT_REMOTE_KEY = testId("input-remote-key");
export const INPUT_REMOTE_PASSWORD = testId("input-remote-password");
export const BTN_TEST_CONNECTION = testId("btn-test-connection");
