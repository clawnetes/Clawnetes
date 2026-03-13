import type { SkillOption, ToolDefinition, ToolPolicy } from "../types";

export const TOOL_GROUP_LABELS: Record<string, string> = {
  "group:runtime": "Runtime",
  "group:fs": "Files",
  "group:sessions": "Sessions",
  "group:memory": "Memory",
  "group:web": "Web",
  "group:ui": "UI",
  "group:automation": "Automation",
  "group:messaging": "Messaging",
  "group:nodes": "Nodes",
  "group:openclaw": "OpenClaw Core",
};

export const TOOL_GROUPS: Record<string, string[]> = {
  "group:runtime": ["exec", "bash", "process"],
  "group:fs": ["read", "write", "edit", "apply_patch"],
  "group:sessions": [
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "session_status",
    "agents_list",
  ],
  "group:memory": ["memory_search", "memory_get"],
  "group:web": ["web_search", "web_fetch"],
  "group:ui": ["browser", "canvas"],
  "group:automation": ["cron", "gateway"],
  "group:messaging": ["message"],
  "group:nodes": ["nodes"],
  "group:openclaw": [
    "read",
    "write",
    "edit",
    "apply_patch",
    "exec",
    "bash",
    "process",
    "web_search",
    "web_fetch",
    "memory_search",
    "memory_get",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "session_status",
    "agents_list",
    "browser",
    "canvas",
    "message",
    "cron",
    "gateway",
    "nodes",
    "image",
    "tts",
  ],
};

export const TOOL_PROFILE_IDS = ["minimal", "coding", "messaging", "full"] as const;

export const TOOL_PROFILES = {
  minimal: ["session_status"],
  coding: [
    ...TOOL_GROUPS["group:fs"],
    ...TOOL_GROUPS["group:runtime"],
    ...TOOL_GROUPS["group:sessions"],
    ...TOOL_GROUPS["group:memory"],
    "image",
  ],
  messaging: [
    ...TOOL_GROUPS["group:messaging"],
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "session_status",
  ],
  full: TOOL_GROUPS["group:openclaw"],
} as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { id: "read", name: "read", description: "Read file contents", section: "Files" },
  { id: "write", name: "write", description: "Create or overwrite files", section: "Files" },
  { id: "edit", name: "edit", description: "Make precise edits", section: "Files" },
  { id: "apply_patch", name: "apply_patch", description: "Patch files safely", section: "Files" },
  { id: "exec", name: "exec", description: "Run shell commands", section: "Runtime" },
  { id: "bash", name: "bash", description: "Run bash snippets", section: "Runtime" },
  { id: "process", name: "process", description: "Manage background processes", section: "Runtime" },
  { id: "web_search", name: "web_search", description: "Search the web", section: "Web" },
  { id: "web_fetch", name: "web_fetch", description: "Fetch web pages", section: "Web" },
  { id: "memory_search", name: "memory_search", description: "Semantic memory search", section: "Memory" },
  { id: "memory_get", name: "memory_get", description: "Read memory records", section: "Memory" },
  { id: "sessions_list", name: "sessions_list", description: "List agent sessions", section: "Sessions" },
  { id: "sessions_history", name: "sessions_history", description: "Inspect session history", section: "Sessions" },
  { id: "sessions_send", name: "sessions_send", description: "Send to a session", section: "Sessions" },
  { id: "sessions_spawn", name: "sessions_spawn", description: "Spawn sub-agent sessions", section: "Sessions" },
  { id: "session_status", name: "session_status", description: "Inspect the current session", section: "Sessions" },
  { id: "browser", name: "browser", description: "Control the browser", section: "UI" },
  { id: "canvas", name: "canvas", description: "Control canvases", section: "UI" },
  { id: "message", name: "message", description: "Send messages", section: "Messaging" },
  { id: "cron", name: "cron", description: "Manage cron jobs", section: "Automation" },
  { id: "gateway", name: "gateway", description: "Control the gateway", section: "Automation" },
  { id: "nodes", name: "nodes", description: "Access nodes", section: "Nodes" },
  { id: "agents_list", name: "agents_list", description: "List targetable agents", section: "Agents" },
  { id: "image", name: "image", description: "Image understanding", section: "Media" },
  { id: "tts", name: "tts", description: "Text-to-speech conversion", section: "Media" },
];

const LEGACY_TOOL_MAP: Record<string, string[]> = {
  filesystem: TOOL_GROUPS["group:fs"],
  terminal: TOOL_GROUPS["group:runtime"],
  browser: ["browser"],
  network: TOOL_GROUPS["group:web"],
};

const TOOL_ID_ALIASES: Record<string, string> = {
  sessions_status: "session_status",
};

export const DEFAULT_TOOL_POLICY: ToolPolicy = {
  profile: "coding",
  allow: [],
  deny: [],
};

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function normalizeToolId(id: string) {
  return TOOL_ID_ALIASES[id] ?? id;
}

function expandToolId(id: string) {
  const normalized = normalizeToolId(id);
  if (TOOL_GROUPS[normalized]) return TOOL_GROUPS[normalized];
  if (LEGACY_TOOL_MAP[normalized]) return LEGACY_TOOL_MAP[normalized];
  return [normalized];
}

function normalizeToolEntries(entries: string[] | null | undefined) {
  return dedupe((entries ?? []).flatMap(expandToolId));
}

function sortIds(values: Iterable<string>) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function getSkillIdSet(skills: SkillOption[]) {
  return new Set(skills.map((skill) => skill.id));
}

export function getAllKnownToolIds() {
  return new Set(TOOL_DEFINITIONS.map((tool) => tool.id));
}

export function getEffectiveEnabledToolIds(policy: ToolPolicy) {
  if (policy.profile === "full") {
    const denied = new Set(normalizeToolEntries(policy.deny));
    return new Set(
      TOOL_DEFINITIONS.map((tool) => tool.id).filter((toolId) => !denied.has(toolId)),
    );
  }

  const base = new Set(
    policy.profile ? TOOL_PROFILES[policy.profile] : [],
  );
  for (const toolId of normalizeToolEntries(policy.allow)) base.add(toolId);
  for (const toolId of normalizeToolEntries(policy.deny)) base.delete(toolId);
  return base;
}

export function sanitizeAllowedTools(
  allowedTools: string[] | null | undefined,
  knownSkillIds: Set<string>,
) {
  return dedupe(
    normalizeToolEntries(allowedTools).filter((id) => !knownSkillIds.has(id)),
  );
}

export function normalizeSkillAndToolSelection(
  skills: string[] | null | undefined,
  allowedTools: string[] | null | undefined,
  knownSkillIds: Set<string>,
) {
  const toolIds = normalizeToolEntries(allowedTools);
  const migratedSkills = toolIds.filter((id) => knownSkillIds.has(id));

  return {
    skills: dedupe([...(skills ?? []), ...migratedSkills]),
    allowedTools: dedupe(toolIds.filter((id) => !knownSkillIds.has(id))),
  };
}

function maybeProfileForTools(toolIds: string[]) {
  const sorted = sortIds(toolIds);
  for (const profileId of TOOL_PROFILE_IDS) {
    if (profileId === "full") continue;
    const profileTools = sortIds(TOOL_PROFILES[profileId]);
    if (sorted.length === profileTools.length && sorted.every((id, idx) => id === profileTools[idx])) {
      return profileId;
    }
  }
  return null;
}

export function normalizeToolPolicy(
  policy: Partial<ToolPolicy> | null | undefined,
  knownSkillIds?: Set<string>,
) {
  const profile = policy?.profile ?? null;
  const allow = normalizeToolEntries(policy?.allow).filter((id) => !knownSkillIds?.has(id));
  const deny = normalizeToolEntries(policy?.deny).filter((id) => !knownSkillIds?.has(id));

  return {
    profile,
    allow: dedupe(allow),
    deny: dedupe(deny),
    elevatedEnabled: policy?.elevatedEnabled ?? false,
  } satisfies ToolPolicy;
}

export function deriveToolPolicyFromLegacy(
  toolsMode: string | null | undefined,
  allowedTools: string[] | null | undefined,
  deniedTools: string[] | null | undefined,
  knownSkillIds: Set<string>,
) {
  const normalizedAllowed = sanitizeAllowedTools(allowedTools, knownSkillIds);
  const normalizedDenied = dedupe(
    normalizeToolEntries(deniedTools).filter((id) => !knownSkillIds.has(id)),
  );

  if (toolsMode === "denylist") {
    return normalizeToolPolicy({
      profile: "full",
      deny: normalizedDenied,
    });
  }

  if (toolsMode === "all") {
    return normalizeToolPolicy({ profile: "full" });
  }

  const matchedProfile = maybeProfileForTools(normalizedAllowed);
  return normalizeToolPolicy({
    profile: matchedProfile,
    allow: matchedProfile ? [] : normalizedAllowed,
  });
}

export function getUnknownToolIds(policy: ToolPolicy) {
  const known = getAllKnownToolIds();
  return sortIds(
    [...normalizeToolEntries(policy.allow), ...normalizeToolEntries(policy.deny)].filter(
      (id) => !known.has(id),
    ),
  );
}

export function toggleToolInPolicy(policy: ToolPolicy, toolId: string, enabled: boolean) {
  const effective = getEffectiveEnabledToolIds(policy);
  const currentlyEnabled = effective.has(toolId);
  if (currentlyEnabled === enabled) return policy;

  const nextAllow = new Set(policy.allow);
  const nextDeny = new Set(policy.deny);
  const baseHasTool = policy.profile === "full"
    ? true
    : new Set(policy.profile ? TOOL_PROFILES[policy.profile] : []).has(toolId);

  if (enabled) {
    nextDeny.delete(toolId);
    if (!baseHasTool) nextAllow.add(toolId);
  } else {
    nextAllow.delete(toolId);
    if (baseHasTool || policy.profile === "full") nextDeny.add(toolId);
  }

  return normalizeToolPolicy({
    ...policy,
    allow: [...nextAllow],
    deny: [...nextDeny],
  });
}

export function setToolProfile(policy: ToolPolicy, profile: ToolPolicy["profile"]) {
  return normalizeToolPolicy({
    profile,
    allow: [],
    deny: [],
    elevatedEnabled: policy.elevatedEnabled ?? false,
  });
}

export function getSectionedToolDefinitions() {
  const sections = new Map<string, ToolDefinition[]>();
  for (const tool of TOOL_DEFINITIONS) {
    const current = sections.get(tool.section) ?? [];
    current.push(tool);
    sections.set(tool.section, current);
  }
  return [...sections.entries()].map(([section, tools]) => ({ section, tools }));
}
