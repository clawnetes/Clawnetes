/**
 * Inject Tauri IPC mocks into the webview via browser.execute().
 *
 * This intercepts the `window.__TAURI_IPC__` function so that Tauri `invoke()`
 * calls resolve with canned responses. This mirrors the mock pattern used in
 * src/__tests__/wizardNavigation.test.tsx.
 */
export async function injectIpcMocks(): Promise<void> {
  await browser.execute(() => {
    // Map of command names to mock responses
    const mockResponses: Record<string, unknown> = {
      check_prerequisites: {
        node_installed: true,
        docker_running: true,
        openclaw_installed: true,
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

    // Store a reference to the original IPC handler (if any)
    const originalIpc = (window as any).__TAURI_IPC__;

    (window as any).__TAURI_IPC__ = (message: any) => {
      let parsed: any;
      try {
        parsed = typeof message === "string" ? JSON.parse(message) : message;
      } catch {
        parsed = message;
      }

      const cmd = parsed?.cmd;
      const callback = parsed?.callback;
      const errorCallback = parsed?.error;

      // Look up mock response
      if (cmd && cmd in mockResponses) {
        const response = mockResponses[cmd];
        // Tauri v1 IPC uses window[`_${callback}`] for the success callback
        if (callback != null && typeof (window as any)[`_${callback}`] === "function") {
          (window as any)[`_${callback}`](response);
        }
        return;
      }

      // For the tapiCommandCallback pattern used by Tauri v1
      if (cmd === "tauri" && parsed?.__tauriModule === "Shell" && parsed?.message?.cmd === "open") {
        // Mock shell.open - do nothing
        if (callback != null && typeof (window as any)[`_${callback}`] === "function") {
          (window as any)[`_${callback}`](null);
        }
        return;
      }

      // Fall through to original handler for unrecognized commands
      if (originalIpc) {
        return originalIpc(message);
      }
    };
  });
}

/**
 * Update a specific mock response at runtime.
 */
export async function setMockResponse(command: string, response: unknown): Promise<void> {
  await browser.execute(
    (cmd: string, resp: unknown) => {
      // This relies on the mock being in closure scope from injectIpcMocks.
      // Instead, we patch __TAURI_IPC__ to recognize the new response.
      const currentHandler = (window as any).__TAURI_IPC__;
      const wrappedHandler = (message: any) => {
        let parsed: any;
        try {
          parsed = typeof message === "string" ? JSON.parse(message) : message;
        } catch {
          parsed = message;
        }

        if (parsed?.cmd === cmd) {
          const callback = parsed?.callback;
          if (callback != null && typeof (window as any)[`_${callback}`] === "function") {
            (window as any)[`_${callback}`](resp);
          }
          return;
        }

        return currentHandler(message);
      };
      (window as any).__TAURI_IPC__ = wrappedHandler;
    },
    command,
    response
  );
}
