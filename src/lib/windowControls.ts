type WindowUnlisten = () => void;

function hasTauriWindowRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function importWindowModule() {
  return await import("@tauri-apps/api/window");
}

async function withCurrentWindow<T>(action: (currentWindow: ReturnType<Awaited<typeof importWindowModule>["getCurrentWindow"]>) => Promise<T>) {
  if (!hasTauriWindowRuntime()) {
    return null;
  }

  const windowModule = await importWindowModule();
  return await action(windowModule.getCurrentWindow());
}

export async function startWindowDragging() {
  await withCurrentWindow(async (currentWindow) => {
    await currentWindow.startDragging();
    return null;
  });
}

export async function minimizeWindow() {
  await withCurrentWindow(async (currentWindow) => {
    await currentWindow.minimize();
    return null;
  });
}

export async function toggleMaximizeWindow() {
  await withCurrentWindow(async (currentWindow) => {
    await currentWindow.toggleMaximize();
    return null;
  });
}

export async function closeWindow() {
  await withCurrentWindow(async (currentWindow) => {
    await currentWindow.close();
    return null;
  });
}

export async function isWindowMaximized() {
  return (
    (await withCurrentWindow(async (currentWindow) => {
      return await currentWindow.isMaximized();
    })) ?? false
  );
}

export async function onWindowResized(handler: () => void): Promise<WindowUnlisten | null> {
  return (
    (await withCurrentWindow(async (currentWindow) => {
      return await currentWindow.onResized(() => handler());
    })) ?? null
  );
}
