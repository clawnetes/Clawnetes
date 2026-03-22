function isStorage(value: unknown): value is Storage {
  return (
    Boolean(value) &&
    typeof (value as Storage).getItem === "function" &&
    typeof (value as Storage).setItem === "function"
  );
}

export function getSafeLocalStorage(): Storage | null {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const processValue = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };

  if (processValue.process?.env?.VITEST) {
    return descriptor && !descriptor.get && isStorage(descriptor.value) ? descriptor.value : null;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    try {
      return isStorage(window.localStorage) ? window.localStorage : null;
    } catch {
      return null;
    }
  }

  return descriptor && !descriptor.get && isStorage(descriptor.value) ? descriptor.value : null;
}
