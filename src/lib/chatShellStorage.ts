import { getSafeLocalStorage } from "./localStorage";

export type ChatThemePreference = "system" | "light" | "dark";
export type ChatResolvedTheme = "light" | "dark";
export type StoredThreadStatus = "draft" | "live" | "archived";

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp?: number;
  error?: boolean;
}

export interface StoredChatThread {
  id: string;
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  title: string;
  preview: string;
  updatedAt: number;
  status: StoredThreadStatus;
  messages: StoredChatMessage[];
}

const THREADS_KEY = "clawnetes.chat.threads.v1";
const SELECTION_KEY = "clawnetes.chat.selection.v1";
const THEME_KEY = "clawnetes.chat.theme.v1";
const MAX_THREADS_PER_SCOPE = 30;
const MAX_MESSAGES_PER_THREAD = 80;

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
    // Ignore quota and serialization failures in the chat shell.
  }
}

function removeKey(key: string) {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage failures in the chat shell.
  }
}

function clampThreads(threads: StoredChatThread[]) {
  return threads
    .map((thread) => ({
      ...thread,
      messages: thread.messages.slice(-MAX_MESSAGES_PER_THREAD),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS_PER_SCOPE);
}

export function buildChatScopeKey(scope: { wsUrl?: string; targetEnvironment?: string; gatewayPort?: number }) {
  return [scope.targetEnvironment || "local", scope.gatewayPort || 0, scope.wsUrl || ""].join("|");
}

export function loadStoredThreads(scopeKey: string): StoredChatThread[] {
  const allThreads = readJson<Record<string, StoredChatThread[]>>(THREADS_KEY) || {};
  return Array.isArray(allThreads[scopeKey]) ? allThreads[scopeKey] : [];
}

export function saveStoredThreads(scopeKey: string, threads: StoredChatThread[]) {
  const allThreads = readJson<Record<string, StoredChatThread[]>>(THREADS_KEY) || {};
  allThreads[scopeKey] = clampThreads(threads);
  writeJson(THREADS_KEY, allThreads);
}

export function loadStoredSelection(scopeKey: string, agentId: string): string {
  const selections = readJson<Record<string, string>>(SELECTION_KEY) || {};
  return selections[`${scopeKey}|${agentId}`] || "";
}

export function saveStoredSelection(scopeKey: string, agentId: string, threadId: string) {
  const selections = readJson<Record<string, string>>(SELECTION_KEY) || {};
  selections[`${scopeKey}|${agentId}`] = threadId;
  writeJson(SELECTION_KEY, selections);
}

export function loadThemePreference(): ChatThemePreference {
  const storage = getSafeLocalStorage();
  const raw = storage?.getItem(THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function saveThemePreference(theme: ChatThemePreference) {
  const storage = getSafeLocalStorage();
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // Ignore storage failures in the theme toggle.
  }
}

export function resolveThemePreference(theme: ChatThemePreference, prefersDark: boolean): ChatResolvedTheme {
  if (theme === "system") {
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

export function clearAllChatShellStorage() {
  removeKey(THREADS_KEY);
  removeKey(SELECTION_KEY);
  removeKey(THEME_KEY);
}
