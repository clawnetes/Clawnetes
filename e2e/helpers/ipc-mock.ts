import { Page } from "@playwright/test";

/**
 * Inject Tauri IPC mocks into the page.
 *
 * This intercepts `window.__TAURI_IPC__` so that `invoke()` calls from
 * @tauri-apps/api resolve with canned responses — no Rust backend needed.
 * Mirrors the mock pattern in src/__tests__/wizardNavigation.test.tsx.
 */
export async function injectIpcMocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mockResponses: Record<string, unknown> = {
      // System checks
      check_prerequisites: {
        node_installed: true,
        docker_running: true,
        openclaw_installed: false,
      },
      has_saved_license: true,
      get_openclaw_version: "1.0.0",

      // Configuration
      configure_agent: null,
      get_current_config: null,
      validate_openclaw_config: "Config is valid.",

      // License
      verify_license_key: true,
      get_saved_license: null,
      save_license: null,

      // Installation
      install_node: null,
      install_openclaw: null,
      install_skill: null,
      install_remote_skill: null,
      create_custom_skill: null,

      // Gateway
      start_gateway: null,
      restart_openclaw_gateway: null,

      // Agent sessions
      initialize_agent_sessions: null,

      // SSH/Remote
      ssh_connect: null,
      start_tunnel: null,
      start_ssh_tunnel: null,
      stop_tunnel: null,
      stop_ssh_tunnel: null,
      verify_tunnel_connectivity: true,
      check_remote_prerequisites: {
        node_installed: true,
        docker_running: true,
        openclaw_installed: false,
      },
      get_remote_openclaw_version: "1.0.0",
      setup_remote_openclaw: null,

      // Messaging / Pairing
      run_maintenance: null,
      get_pairing_code: "MOCK-1234",
      generate_pairing_code: "Send /start to your bot",
      check_messaging_link_status: false,
      get_dashboard_url: "http://127.0.0.1:18789",

      // Model detection
      get_ollama_models: [],
      get_lmstudio_models: [],

      // Workspace
      save_workspace: null,

      // App control
      close_app: null,
    };

    // Intercept Tauri IPC before the app loads
    Object.defineProperty(window, "__TAURI_IPC__", {
      value: (message: unknown) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = typeof message === "string" ? JSON.parse(message) : (message as Record<string, unknown>);
        } catch {
          return;
        }

        const cmd = parsed.cmd as string;
        const callback = parsed.callback as number | undefined;

        if (cmd && cmd in mockResponses) {
          const response = mockResponses[cmd];
          if (callback != null) {
            const callbackFn = (window as Record<string, unknown>)[`_${callback}`];
            if (typeof callbackFn === "function") {
              (callbackFn as (v: unknown) => void)(response);
            }
          }
          return;
        }

        // Handle shell.open and other Tauri module calls
        if (cmd === "tauri") {
          if (callback != null) {
            const callbackFn = (window as Record<string, unknown>)[`_${callback}`];
            if (typeof callbackFn === "function") {
              (callbackFn as (v: unknown) => void)(null);
            }
          }
        }
      },
      writable: true,
      configurable: true,
    });
  });
}
