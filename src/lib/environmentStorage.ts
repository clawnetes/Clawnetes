import { getSafeLocalStorage } from "./localStorage";
import { generateUUID } from "./gatewayUuid";
import type { AgentPlatform } from "../platforms/types";

export interface StoredEnvironment {
  id: string;
  name: string;
  platform: AgentPlatform;
  type: "local" | "cloud";
  remoteIp?: string;
  remoteUser?: string;
  remotePassword?: string;
  remotePrivateKeyPath?: string;
  addedAt: number;
  lastUsedAt: number;
}

const ENVIRONMENTS_KEY = "clawnetes.environments.v1";
const ACTIVE_ENV_KEY = "clawnetes.environments.active.v1";
const LEGACY_REMOTE_KEY = "clawnetes.remote.lastConnection.v1";

function readJson<T>(key: string): T | null {
  const storage = getSafeLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota and serialization failures.
  }
}

function removeKey(key: string): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function isValidEnvironment(env: unknown): env is StoredEnvironment {
  if (!env || typeof env !== "object") return false;
  const legacy = env as Record<string, unknown>;
  const e = {
    ...legacy,
    platform: legacy.platform === "hermes" ? "hermes" : "openclaw",
  } as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    (e.platform === "openclaw" || e.platform === "hermes") &&
    (e.type === "local" || e.type === "cloud") &&
    typeof e.addedAt === "number" &&
    typeof e.lastUsedAt === "number"
  );
}

function buildName(type: "local" | "cloud", remoteUser?: string, remoteIp?: string): string {
  if (type === "local") return "Local";
  return `${remoteUser || "unknown"}@${remoteIp || "unknown"}`;
}

export function loadEnvironments(): StoredEnvironment[] {
  const raw = readJson<unknown[]>(ENVIRONMENTS_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }
  const valid = raw
    .filter(isValidEnvironment)
    .map((env) => ({
      ...env,
      platform: (env.platform === "hermes" ? "hermes" : "openclaw") as import("../platforms/types").AgentPlatform,
    }));
  if (valid.length === 0) {
    return [];
  }
  return valid;
}

export function saveEnvironments(envs: StoredEnvironment[]): void {
  writeJson(ENVIRONMENTS_KEY, envs);
  removeKey(LEGACY_REMOTE_KEY);
}

export function upsertEnvironment(env: {
  platform: AgentPlatform;
  type: "local" | "cloud";
  remoteIp?: string;
  remoteUser?: string;
  remotePassword?: string;
  remotePrivateKeyPath?: string;
}): StoredEnvironment {
  const envs = loadEnvironments();
  const now = Date.now();

  const existing = envs.find((e) => {
    if (e.platform !== env.platform) return false;
    if (e.type !== env.type) return false;
    if (env.type === "local") return true;
    return e.remoteIp === env.remoteIp && e.remoteUser === env.remoteUser;
  });

  if (existing) {
    existing.lastUsedAt = now;
    existing.name = buildName(env.type, env.remoteUser, env.remoteIp);
    if (env.remotePassword !== undefined) existing.remotePassword = env.remotePassword;
    if (env.remotePrivateKeyPath !== undefined) existing.remotePrivateKeyPath = env.remotePrivateKeyPath;
    saveEnvironments(envs);
    return existing;
  }

  const newEnv: StoredEnvironment = {
    id: generateUUID(),
    name: buildName(env.type, env.remoteUser, env.remoteIp),
    platform: env.platform,
    type: env.type,
    remoteIp: env.remoteIp,
    remoteUser: env.remoteUser,
    remotePassword: env.remotePassword,
    remotePrivateKeyPath: env.remotePrivateKeyPath,
    addedAt: now,
    lastUsedAt: now,
  };
  envs.push(newEnv);
  saveEnvironments(envs);
  return newEnv;
}

export function removeEnvironment(id: string): void {
  const envs = loadEnvironments().filter((e) => e.id !== id);
  saveEnvironments(envs);
  if (getActiveEnvironmentId() === id) {
    removeKey(ACTIVE_ENV_KEY);
  }
}

export function getActiveEnvironmentId(): string | null {
  return readJson<string>(ACTIVE_ENV_KEY);
}

export function setActiveEnvironmentId(id: string): void {
  writeJson(ACTIVE_ENV_KEY, id);
}
