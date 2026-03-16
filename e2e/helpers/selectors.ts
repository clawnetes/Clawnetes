/**
 * Centralized selectors for E2E tests.
 *
 * Uses a combination of data-testid attributes (preferred) and
 * text/class-based selectors as fallbacks.
 */

// --- data-testid selectors (Step 7 additions) ---
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

// --- Text-based selectors (fallback) ---
export const btnText = (text: string) => `button=${text}`;
export const inputPlaceholder = (placeholder: string) => `input[placeholder="${placeholder}"]`;

// --- Class selectors ---
export const STEP_VIEW = ".step-view";
export const MODE_CARD = ".mode-card";
export const WELCOME_TITLE = ".welcome-title";
