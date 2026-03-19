import { Page } from "@playwright/test";

/**
 * Inject a real IPC bridge into the page.
 *
 * Replaces `window.__TAURI_IPC__` with a function that routes all
 * invoke() calls to the bridge HTTP server via fetch(), which then
 * executes real shell commands.
 */
export async function injectIpcBridge(page: Page, bridgePort: number): Promise<void> {
  await page.addInitScript((port: number) => {
    Object.defineProperty(window, "__TAURI_IPC__", {
      value: async (message: unknown) => {
        let parsed: Record<string, unknown>;
        try {
          parsed =
            typeof message === "string"
              ? JSON.parse(message)
              : (message as Record<string, unknown>);
        } catch {
          return;
        }

        const { cmd, callback, error, ...rest } = parsed;

        // Handle Tauri module calls (shell.open, etc.)
        const effectiveCmd = cmd === "tauri" ? "tauri" : (cmd as string);

        try {
          const res = await fetch(`http://localhost:${port}/ipc`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cmd: effectiveCmd, args: rest }),
          });
          const data = await res.json();

          if (data.error) {
            const errFn = (window as Record<string, unknown>)[`_${error}`];
            if (typeof errFn === "function") {
              (errFn as (v: unknown) => void)(data.error);
            }
          } else {
            const cbFn = (window as Record<string, unknown>)[`_${callback}`];
            if (typeof cbFn === "function") {
              (cbFn as (v: unknown) => void)(data.result);
            }
          }
        } catch (e) {
          const errFn = (window as Record<string, unknown>)[`_${error}`];
          if (typeof errFn === "function") {
            (errFn as (v: unknown) => void)(String(e));
          }
        }
      },
      writable: true,
      configurable: true,
    });
  }, bridgePort);
}
