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
      check_prerequisites: {
        node_installed: true,
        docker_running: true,
        openclaw_installed: false,
      },
      has_saved_license: false,
      get_openclaw_version: "1.0.0",
      configure_agent: null,
      get_current_config: null,
      verify_license_key: true,
      get_saved_license: null,
      save_license: null,
      install_node: null,
      ssh_connect: null,
      start_tunnel: null,
      stop_tunnel: null,
      run_maintenance: null,
      get_pairing_code: "MOCK-1234",
      get_dashboard_url: "http://127.0.0.1:18789",
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

        // Handle shell.open (Tauri module calls)
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
