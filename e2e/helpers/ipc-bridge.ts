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
    const callbacks = new Map<number, (value: unknown) => void>();
    let nextCallbackId = 1;

    const invoke = async (cmd: string, args?: Record<string, unknown>) => {
      const effectiveCmd = cmd === "tauri" ? "tauri" : cmd;
      const res = await fetch(`http://localhost:${port}/ipc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: effectiveCmd, args: args || {} }),
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      }
      return data.result;
    };

    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke,
        transformCallback(callback: (value: unknown) => void) {
          const id = nextCallbackId++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(callbackId: number) {
          callbacks.delete(callbackId);
        },
        convertFileSrc(filePath: string) {
          return filePath;
        },
      },
      writable: true,
      configurable: true,
    });

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

        try {
          const result = await invoke(cmd as string, rest);
          const cbFn = (window as Record<string, unknown>)[`_${callback}`];
          if (typeof cbFn === "function") {
            (cbFn as (value: unknown) => void)(result);
          }
        } catch (e) {
          const errFn = (window as Record<string, unknown>)[`_${error}`];
          if (typeof errFn === "function") {
            (errFn as (value: unknown) => void)(String(e));
          }
        }
      },
      writable: true,
      configurable: true,
    });
  }, bridgePort);
}
