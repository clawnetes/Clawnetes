import { getSafeLocalStorage } from "./localStorage";

export interface StoredRemoteConnection {
  ip: string;
  user: string;
}

const REMOTE_CONNECTION_KEY = "clawnetes.remote.lastConnection.v1";

function readJson<T>(key: string): T | null {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota and serialization failures.
  }
}

export function loadLastRemoteConnection(): StoredRemoteConnection | null {
  const stored = readJson<StoredRemoteConnection>(REMOTE_CONNECTION_KEY);
  if (!stored || typeof stored.ip !== "string" || typeof stored.user !== "string") {
    return null;
  }
  return stored;
}

export function saveLastRemoteConnection(ip: string, user: string): void {
  writeJson(REMOTE_CONNECTION_KEY, { ip, user });
}

function connectionsMatch(
  stored: StoredRemoteConnection | null,
  ip: string,
  user: string,
): stored is StoredRemoteConnection {
  return Boolean(stored && stored.ip === ip && stored.user === user);
}

export function clearLastRemoteConnection(): void {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(REMOTE_CONNECTION_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function clearLastRemoteConnectionIfMatches(ip: string, user: string): boolean {
  if (!connectionsMatch(loadLastRemoteConnection(), ip, user)) {
    return false;
  }

  clearLastRemoteConnection();
  return true;
}
