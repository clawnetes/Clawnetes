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
const ACTIVE_ENV_KEY = "clawnetes.environments.active.v2";
const LEGACY_ACTIVE_ENV_KEY = "clawnetes.environments.active.v1";
const LEGACY_REMOTE_KEY = "clawnetes.remote.lastConnection.v1";

type ActiveEnvironmentMap = Partial<Record<AgentPlatform, string>>;

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

function isValidActiveEnvironmentMap(value: unknown): value is ActiveEnvironmentMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([platform, id]) => (
    (platform === "openclaw" || platform === "hermes")
    && typeof id === "string"
  ));
}

function loadActiveEnvironmentMap(): ActiveEnvironmentMap {
  const current = readJson<unknown>(ACTIVE_ENV_KEY);
  if (isValidActiveEnvironmentMap(current)) {
    return current;
  }

  const legacyId = readJson<string>(LEGACY_ACTIVE_ENV_KEY);
  if (!legacyId) {
    return {};
  }

  const legacyEnv = loadEnvironments().find((env) => env.id === legacyId);
  if (!legacyEnv) {
    removeKey(LEGACY_ACTIVE_ENV_KEY);
    return {};
  }

  const migrated: ActiveEnvironmentMap = { [legacyEnv.platform]: legacyEnv.id };
  writeJson(ACTIVE_ENV_KEY, migrated);
  removeKey(LEGACY_ACTIVE_ENV_KEY);
  return migrated;
}

function saveActiveEnvironmentMap(map: ActiveEnvironmentMap): void {
  if (Object.keys(map).length === 0) {
    removeKey(ACTIVE_ENV_KEY);
  } else {
    writeJson(ACTIVE_ENV_KEY, map);
  }
  removeKey(LEGACY_ACTIVE_ENV_KEY);
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
  const envs = loadEnvironments();
  const removed = envs.find((e) => e.id === id);
  const nextEnvs = envs.filter((e) => e.id !== id);
  saveEnvironments(nextEnvs);

  if (removed) {
    const activeMap = loadActiveEnvironmentMap();
    if (activeMap[removed.platform] === id) {
      delete activeMap[removed.platform];
      saveActiveEnvironmentMap(activeMap);
    }
  } else if (getActiveEnvironmentId() === id) {
    removeKey(ACTIVE_ENV_KEY);
    removeKey(LEGACY_ACTIVE_ENV_KEY);
  }
}

export function getActiveEnvironmentId(platform?: AgentPlatform): string | null {
  const activeMap = loadActiveEnvironmentMap();
  if (platform) {
    return activeMap[platform] || null;
  }

  const legacyId = readJson<string>(LEGACY_ACTIVE_ENV_KEY);
  if (legacyId) {
    return legacyId;
  }

  const preferredPlatform = activeMap.hermes ? "hermes" : "openclaw";
  return activeMap[preferredPlatform] || null;
}

export function setActiveEnvironmentId(id: string, platform?: AgentPlatform): void {
  const activeMap = loadActiveEnvironmentMap();
  const resolvedPlatform = platform || loadEnvironments().find((env) => env.id === id)?.platform;
  if (!resolvedPlatform) {
    writeJson(LEGACY_ACTIVE_ENV_KEY, id);
    return;
  }
  activeMap[resolvedPlatform] = id;
  saveActiveEnvironmentMap(activeMap);
  writeJson(LEGACY_ACTIVE_ENV_KEY, id);
}

export function getPreferredEnvironment(platform: AgentPlatform): StoredEnvironment | null {
  const environments = loadEnvironments()
    .filter((env) => env.platform === platform)
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt);
  if (environments.length === 0) {
    return null;
  }

  const activeId = getActiveEnvironmentId(platform);
  if (activeId) {
    const active = environments.find((env) => env.id === activeId);
    if (active) {
      return active;
    }
  }

  return environments[0];
}

export function getPreferredEnvironmentForType(
  platform: AgentPlatform,
  type: "local" | "cloud",
): StoredEnvironment | null {
  const environments = loadEnvironments()
    .filter((env) => env.platform === platform && env.type === type)
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt);
  if (environments.length === 0) {
    return null;
  }

  const activeId = getActiveEnvironmentId(platform);
  if (activeId) {
    const active = environments.find((env) => env.id === activeId);
    if (active) {
      return active;
    }
  }

  return environments[0];
}
