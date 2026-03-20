import { getSafeLocalStorage } from "./localStorage";

type DeviceAuthEntry = {
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
};

type DeviceAuthStore = {
  version: 1;
  deviceId: string;
  tokens: Record<string, DeviceAuthEntry>;
};

const STORAGE_KEY = "openclaw.device.auth.v1";

function normalizeRole(role: string) {
  return role.trim();
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) {
    return [];
  }
  const out = new Set<string>();
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (trimmed) {
      out.add(trimmed);
    }
  }
  return [...out].toSorted();
}

function readStore(): DeviceAuthStore | null {
  try {
    const raw = getSafeLocalStorage()?.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as DeviceAuthStore;
    if (parsed?.version !== 1 || typeof parsed.deviceId !== "string") {
      return null;
    }
    if (!parsed.tokens || typeof parsed.tokens !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStore(store: DeviceAuthStore) {
  try {
    getSafeLocalStorage()?.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // best effort
  }
}

export function loadDeviceAuthToken(params: { deviceId: string; role: string }): DeviceAuthEntry | null {
  const store = readStore();
  if (!store || store.deviceId !== params.deviceId) {
    return null;
  }
  return store.tokens[normalizeRole(params.role)] ?? null;
}

export function storeDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes?: string[];
}) {
  const existing = readStore();
  const next: DeviceAuthStore = {
    version: 1,
    deviceId: params.deviceId,
    tokens:
      existing && existing.deviceId === params.deviceId && existing.tokens
        ? { ...existing.tokens }
        : {},
  };

  next.tokens[normalizeRole(params.role)] = {
    token: params.token,
    role: normalizeRole(params.role),
    scopes: normalizeScopes(params.scopes),
    updatedAtMs: Date.now(),
  };

  writeStore(next);
}

export function clearDeviceAuthToken(params: { deviceId: string; role: string }) {
  const store = readStore();
  if (!store || store.deviceId !== params.deviceId) {
    return;
  }

  const role = normalizeRole(params.role);
  if (!store.tokens[role]) {
    return;
  }

  const next: DeviceAuthStore = {
    version: 1,
    deviceId: store.deviceId,
    tokens: { ...store.tokens },
  };
  delete next.tokens[role];
  writeStore(next);
}
