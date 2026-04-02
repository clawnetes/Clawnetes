import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentConfigData, ChatTranscriptScrollSnapshot, GatewayChatBootstrap, ProviderAuthConfig, ToolPolicy } from "../../types";
import {
  GatewayChatClient,
  type GatewayAgentEventPayload,
  type GatewayChatAgent,
  type GatewayConnectState,
  type GatewayChatEventPayload,
  type GatewayChatSession,
  type GatewaySessionsChangedPayload,
} from "../../lib/gatewayChat";
import {
  buildChatScopeKey,
  hideLiveSession,
  inferDocumentTheme,
  loadHiddenLiveSessions,
  loadSavedThemePreference,
  loadStoredSelection,
  loadStoredThreads,
  removeStoredSelection,
  resolveThemePreference,
  saveHiddenLiveSessions,
  saveStoredSelection,
  saveStoredThreads,
  saveThemePreference,
  type ChatResolvedTheme,
  type ChatThemePreference,
  type StoredChatThread,
} from "../../lib/chatShellStorage";
import {
  type ChatMessage,
  createThread,
  deriveThreadPreview,
  deriveThreadTitle,
  formatSessionTitle,
  resolveSessionKeyForAgent,
  sanitizeAssistantTranscriptText,
  toChatMessages,
  toStoredMessages,
} from "../../lib/chatMessageFilters";
import { isTerminalSessionSnapshot, preferCanonicalSessionKey, sessionKeysMatch } from "../../lib/chatSessionKeys";

import ChatPanelContext, { type PanelView } from "../../context/ChatPanelContext";
import ChatSidebar from "./ChatSidebar";
import type { StoredEnvironment } from "./ChatSidebar";
import ChatHeader from "./ChatHeader";
import ChatTranscript from "./ChatTranscript";
import ChatComposer from "./ChatComposer";
import RightPanel from "../panel/RightPanel";

export type { StoredEnvironment };

type ChatMessageTailEntry = {
  role: "user" | "assistant";
  text: string;
  requireVisibleText?: boolean;
};

interface ChatShellProps {
  bootstrap: GatewayChatBootstrap | null;
  bootstrapping: boolean;
  bootstrapError: string;
  onRetryConnection: () => void;
  onOpenConfigure: (snapshot: ChatTranscriptScrollSnapshot | null) => void;
  environments?: StoredEnvironment[];
  activeEnvironmentId?: string | null;
  onSwitchEnvironment?: (envId: string) => void;
  onAddEnvironment?: () => void;
  onRemoveEnvironment?: (envId: string) => void;
  onAgentSwitch?: (agentId: string) => void;
  agents?: AgentConfigData[];
  activeAgentId?: string;
  agentModelRef?: string;
  agentFallbackCount?: number;
  agentFallbackModels?: string[];
  agentSkills?: string[];
  serviceKeys?: Record<string, string>;
  onModelChange?: (model: string) => void;
  onFallbacksChange?: (models: string[]) => void;
  providerAuths?: Record<string, ProviderAuthConfig>;
  onProviderAuthChange?: (provider: string, auth: ProviderAuthConfig) => void | Promise<void>;
  onStartOAuth?: (provider: string, authMethod: string, oauthProviderId: string) => Promise<ProviderAuthConfig>;
  onDetectLocalModels?: (provider: "ollama" | "lmstudio" | "local", baseUrl?: string) => Promise<string[]>;
  onSaveSkillsConfig?: (skills: string[], serviceKeys: Record<string, string>) => void;
  skillsSaving?: boolean;
  onSetupIntegration?: (skillId: string) => void;
  onAddAgent?: (agent: AgentConfigData) => void | Promise<void>;
  onRemoveAgent?: (agentId: string) => void | Promise<void>;
  // Identity editor
  identityMd?: string;
  soulMd?: string;
  toolsMd?: string;
  agentsMd?: string;
  heartbeatMd?: string;
  memoryMd?: string;
  onIdentitySave?: (tab: string, content: string) => void;
  identitySaving?: boolean;
  // Settings
  targetEnvironment?: string;
  remoteSummary?: string;
  gatewayPort?: number;
  gatewayBind?: string;
  gatewayAuthMode?: string;
  heartbeatMode?: string;
  sandboxMode?: string;
  toolPolicy?: ToolPolicy;
  toolsSaving?: boolean;
  idleTimeoutMs?: number;
  onSaveToolPolicy?: (policy: ToolPolicy) => void;
  onSaveAdvancedSettings?: (heartbeatMode: string, idleTimeoutMs: number, sandboxMode: string) => void;
  settingsBusy?: boolean;
  maintenanceStatus?: string;
  onRepair?: () => void;
  onAudit?: () => void;
  onUpgrade?: () => void;
  onReconfigure?: () => void;
  onUninstall?: () => void;
  isConfigUpdating?: boolean;
  returnScrollSnapshot?: ChatTranscriptScrollSnapshot | null;
  onConsumeReturnScrollSnapshot?: () => void;
}

function readPrefersDark() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getInitialThemeState(): {
  themePreference: ChatThemePreference;
  resolvedTheme: ChatResolvedTheme;
} {
  const savedThemePreference = loadSavedThemePreference();
  if (savedThemePreference) {
    return {
      themePreference: savedThemePreference,
      resolvedTheme: resolveThemePreference(savedThemePreference, readPrefersDark()),
    };
  }

  const inheritedTheme = inferDocumentTheme();
  return {
    themePreference: inheritedTheme,
    resolvedTheme: inheritedTheme,
  };
}

function isNearBottom(element: HTMLDivElement, threshold = 96) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function formatOpenClawStatusLabel(version: string) {
  const trimmedVersion = version.trim();
  if (!trimmedVersion) {
    return "Clawnetes with OpenClaw";
  }
  const normalizedVersion = /^openclaw\b/i.test(trimmedVersion)
    ? trimmedVersion.replace(/^openclaw\s*/i, "")
    : trimmedVersion;
  return `Clawnetes with OpenClaw ${normalizedVersion}`.trim();
}

function isAssistantStreaming(messages: ChatMessage[]) {
  return messages.some((message) => message.role === "assistant" && message.pending);
}

function mergeAssistantStreamText(current: string, incoming: string) {
  if (!current) return incoming;
  if (!incoming) return current;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;

  const maxOverlap = Math.min(current.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (current.slice(-overlap) === incoming.slice(0, overlap)) {
      return `${current}${incoming.slice(overlap)}`;
    }
  }

  return `${current}${incoming}`;
}

function buildRecentVisibleTail(messages: ChatMessage[]): ChatMessageTailEntry[] {
  const visible = toStoredMessages(messages)
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.text.trim());

  if (visible.length === 0) {
    return [];
  }

  const last = visible[visible.length - 1];
  if (
    last.role === "assistant" &&
    visible.length >= 2 &&
    visible[visible.length - 2]?.role === "user"
  ) {
    return visible.slice(-2).map((message) => ({
      role: message.role as "user" | "assistant",
      text: message.text.trim(),
    }));
  }

  return [{
    role: last.role as "user" | "assistant",
    text: last.text.trim(),
  }];
}

function buildReconcileTail(messages: ChatMessage[], runId?: string | null): ChatMessageTailEntry[] {
  const visibleTail = buildRecentVisibleTail(messages);
  if (!runId) {
    const lastVisible = visibleTail[visibleTail.length - 1];
    if (lastVisible?.role === "user") {
      return [
        {
          role: "user",
          text: lastVisible.text,
        },
        {
          role: "assistant",
          text: "",
          requireVisibleText: true,
        },
      ];
    }
    return visibleTail;
  }

  const assistantForRun = messages.find(
    (message) => message.role === "assistant" && message.runId === runId,
  );
  const assistantText = (assistantForRun?.text || "").trim();
  if (assistantForRun && assistantText) {
    return visibleTail;
  }

  const visible = toStoredMessages(messages)
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.text.trim());
  const lastUser = [...visible].reverse().find((message) => message.role === "user");
  if (!lastUser) {
    return [{
      role: "assistant",
      text: "",
      requireVisibleText: true,
    }];
  }

  return [
    {
      role: "user",
      text: lastUser.text.trim(),
    },
    {
      role: "assistant",
      text: "",
      requireVisibleText: true,
    },
  ];
}

function historyContainsRecentTail(messages: ChatMessage[], tail: ChatMessageTailEntry[]) {
  if (tail.length === 0) {
    return true;
  }

  const visible = messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.text.trim())
    .map((message) => ({
      role: message.role as "user" | "assistant",
      text: message.text.trim(),
    }));

  if (visible.length < tail.length) {
    return false;
  }

  const recent = visible.slice(-tail.length);
  return tail.every((entry, index) => {
    const candidate = recent[index];
    if (!candidate || candidate.role !== entry.role) {
      return false;
    }
    if (entry.requireVisibleText) {
      return candidate.text.trim().length > 0;
    }
    return candidate.text === entry.text;
  });
}

const HISTORY_RECONCILE_INTERVAL_MS = 350;
const MAX_HISTORY_RECONCILE_MS = 20_000;
const REPLY_RECOVERY_FAILURE_TEXT = "That reply didn’t come through. Try sending it again.";

function runHasVisibleAssistantMessage(messages: ChatMessage[], runId?: string | null) {
  if (!runId) {
    return false;
  }

  return messages.some((message) => (
    message.role === "assistant" &&
    message.runId === runId &&
    !!sanitizeAssistantTranscriptText(message.rawText || message.text).trim()
  ));
}

function finalizeRunMessages(messages: ChatMessage[], runId?: string | null) {
  if (!runId) {
    return messages;
  }

  return messages.flatMap((message) => {
    if (!message.runId || message.runId !== runId) {
      return [message];
    }

    const visibleText = message.role === "assistant"
      ? sanitizeAssistantTranscriptText(message.rawText || message.text)
      : message.text;

    if (message.role === "assistant" && !visibleText) {
      return [];
    }

    return [{ ...message, text: visibleText, pending: false }];
  });
}

function ensurePendingAssistantMessage(messages: ChatMessage[], runId: string) {
  const existingIndex = messages.findIndex((message) => message.runId === runId);
  if (existingIndex >= 0) {
    return messages;
  }

  return [
    ...messages,
    {
      id: `assistant-${runId}`,
      role: "assistant",
      text: "",
      rawText: "",
      runId,
      pending: true,
    },
  ];
}

function ensurePendingAssistantPlaceholder(messages: ChatMessage[]) {
  const existingPendingAssistant = messages.find(
    (message) =>
      message.role === "assistant" &&
      message.pending &&
      !message.runId &&
      !sanitizeAssistantTranscriptText(message.rawText || message.text).trim(),
  );
  if (existingPendingAssistant) {
    return messages;
  }

  return [
    ...messages,
    {
      id: `assistant-pending-${Date.now()}`,
      role: "assistant",
      text: "",
      rawText: "",
      pending: true,
    },
  ];
}

function attachPendingAssistantRunId(messages: ChatMessage[], runId: string) {
  if (messages.some((message) => message.runId === runId)) {
    return messages;
  }

  let attached = false;
  return messages.map((message) => {
    if (
      attached ||
      message.role !== "assistant" ||
      !message.pending ||
      !!message.runId ||
      !!sanitizeAssistantTranscriptText(message.rawText || message.text).trim()
    ) {
      return message;
    }

    attached = true;
    return {
      ...message,
      id: `assistant-${runId}`,
      runId,
    };
  });
}

function replacePendingAssistantWithRecoveryNotice(messages: ChatMessage[], runId?: string | null) {
  const nextMessages = messages.flatMap((message) => {
    if (
      message.role === "assistant" &&
      message.runId === runId &&
      message.pending &&
      !sanitizeAssistantTranscriptText(message.rawText || message.text).trim()
    ) {
      return [];
    }

    return [message];
  });

  return [
    ...nextMessages,
    {
      id: `reply-recovery-${runId || Date.now()}`,
      role: "system" as const,
      text: REPLY_RECOVERY_FAILURE_TEXT,
      timestamp: Date.now(),
    },
  ];
}

function removePendingAssistantPlaceholder(messages: ChatMessage[], runId?: string | null) {
  return messages.flatMap((message) => {
    if (
      message.role === "assistant" &&
      message.pending &&
      message.runId === runId &&
      !sanitizeAssistantTranscriptText(message.rawText || message.text).trim()
    ) {
      return [];
    }

    return [message];
  });
}

function asSessionLifecycleSnapshot(
  payload?: GatewayChatSession | GatewaySessionsChangedPayload | null,
): GatewayChatSession | GatewaySessionsChangedPayload | null {
  if (!payload) {
    return null;
  }
  if ("session" in payload) {
    return payload.session ?? payload;
  }
  return payload;
}

function sessionMatchesActiveContext(params: {
  sessionKey?: string | null;
  activeSessionKey?: string | null;
  agentId?: string | null;
}) {
  return sessionKeysMatch({
    left: params.sessionKey,
    right: params.activeSessionKey,
    agentId: params.agentId,
  });
}

function ChatShell({
  bootstrap, bootstrapping, bootstrapError, onRetryConnection, onOpenConfigure,
  environments, activeEnvironmentId, onSwitchEnvironment, onAddEnvironment, onRemoveEnvironment, onAgentSwitch,
  agents: propAgents,
  activeAgentId: chatActiveAgentId,
  agentModelRef, agentFallbackCount, agentFallbackModels, agentSkills, serviceKeys,
  onModelChange, onFallbacksChange, providerAuths, onProviderAuthChange, onStartOAuth, onDetectLocalModels, onSaveSkillsConfig, skillsSaving, onSetupIntegration, onAddAgent, onRemoveAgent,
  identityMd, soulMd, toolsMd, agentsMd, heartbeatMd, memoryMd,
  onIdentitySave, identitySaving,
  targetEnvironment, remoteSummary, gatewayPort, gatewayBind, gatewayAuthMode,
  heartbeatMode, sandboxMode, toolPolicy, toolsSaving, idleTimeoutMs, onSaveToolPolicy, onSaveAdvancedSettings, settingsBusy, maintenanceStatus,
  onRepair, onAudit, onUpgrade, onReconfigure, onUninstall, isConfigUpdating = false,
  returnScrollSnapshot = null,
  onConsumeReturnScrollSnapshot,
}: ChatShellProps) {
  const clientRef = useRef<GatewayChatClient | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const activeAgentIdRef = useRef("");
  const activeSessionKeyRef = useRef("");
  const activeThreadIdRef = useRef("");
  const activeRunIdRef = useRef("");
  const sendingRef = useRef(false);
  const settledRunIdsRef = useRef<string[]>([]);
  const threadsRef = useRef<StoredChatThread[]>([]);
  const shouldAutoScrollRef = useRef(true);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior | null>(null);
  const streamFollowEnabledRef = useRef(false);
  const streamFollowRunIdRef = useRef("");
  const userPausedStreamFollowRef = useRef(false);
  const internalReturnScrollSnapshotRef = useRef<ChatTranscriptScrollSnapshot | null>(null);
  const consumedExternalReturnScrollSnapshotRef = useRef<ChatTranscriptScrollSnapshot | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const historyReconcileRef = useRef<{
    sessionKey: string;
    threadId: string;
    tail: ChatMessageTailEntry[];
    runId?: string;
    retries: number;
    startedAt: number;
    requiresVisibleAssistant: boolean;
  } | null>(null);
  const historyReconcileTimerRef = useRef<number | null>(null);
  const streamIdleFinalizeTimerRef = useRef<number | null>(null);
  const deferredSessionRefreshRef = useRef<GatewaySessionsChangedPayload | null>(null);
  const pendingSessionListRefreshRef = useRef(false);
  const configUpdatingRef = useRef(isConfigUpdating);

  const [connectionLabel, setConnectionLabel] = useState("Connecting to gateway...");
  const [connectionState, setConnectionState] = useState<GatewayConnectState["status"]>("connecting");
  const [agents, setAgents] = useState<GatewayChatAgent[]>([]);

  // Prefer gateway-reported agents (always correct for the current environment).
  // Only fall back to propAgents (from App state) when the gateway hasn't reported agents yet.
  const displayAgents = agents.length > 0
    ? agents
    : propAgents && propAgents.length > 0
      ? propAgents.map(a => ({ id: a.id, name: a.name, emoji: a.emoji }))
      : [];
  const [liveSessions, setLiveSessions] = useState<GatewayChatSession[]>([]);
  const [threads, setThreads] = useState<StoredChatThread[]>([]);
  const [activeAgentId, setActiveAgentId] = useState("");
  const [activeSessionKey, setActiveSessionKey] = useState("");
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyRecoveryPending, setReplyRecoveryPending] = useState(false);
  const [activeRunId, setActiveRunId] = useState("");
  const [shellError, setShellError] = useState("");
  const initialThemeStateRef = useRef<{
    themePreference: ChatThemePreference;
    resolvedTheme: ChatResolvedTheme;
  } | null>(null);
  if (!initialThemeStateRef.current) {
    initialThemeStateRef.current = getInitialThemeState();
  }
  const initialThemeState = initialThemeStateRef.current!;
  const [themePreference, setThemePreference] = useState<ChatThemePreference>(initialThemeState.themePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ChatResolvedTheme>(initialThemeState.resolvedTheme);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>("model");

  const captureTranscriptScrollSnapshot = useCallback((): ChatTranscriptScrollSnapshot | null => {
    const transcript = transcriptRef.current;
    if (!transcript || !activeAgentId || !activeSessionKey || !activeThreadId) {
      return null;
    }

    return {
      agentId: activeAgentId,
      sessionKey: activeSessionKey,
      threadId: activeThreadId,
      scrollTop: transcript.scrollTop,
    };
  }, [activeAgentId, activeSessionKey, activeThreadId]);

  const clearReturnScrollSnapshots = useCallback((consumeExternal = false) => {
    internalReturnScrollSnapshotRef.current = null;
    if (consumeExternal) {
      if (returnScrollSnapshot) {
        consumedExternalReturnScrollSnapshotRef.current = returnScrollSnapshot;
      }
      onConsumeReturnScrollSnapshot?.();
    }
  }, [onConsumeReturnScrollSnapshot, returnScrollSnapshot]);

  const hasPendingReturnScrollSnapshot = useCallback(() => {
    const externalSnapshot = returnScrollSnapshot && consumedExternalReturnScrollSnapshotRef.current !== returnScrollSnapshot
      ? returnScrollSnapshot
      : null;
    return !!(internalReturnScrollSnapshotRef.current || externalSnapshot);
  }, [returnScrollSnapshot]);

  useEffect(() => {
    if (!returnScrollSnapshot) {
      consumedExternalReturnScrollSnapshotRef.current = null;
    }
  }, [returnScrollSnapshot]);

  const openPanel = useCallback((view?: PanelView) => {
    internalReturnScrollSnapshotRef.current = captureTranscriptScrollSnapshot();
    if (view) setPanelView(view);
    setPanelOpen(true);
  }, [captureTranscriptScrollSnapshot]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, []);

  const scopeKey = bootstrap ? buildChatScopeKey(bootstrap) : "";

  const activeThread = threads.find((thread) => thread.id === activeThreadId) || null;
  const activeThreadIsArchived = activeThread?.status === "archived";

  const isSessionHidden = useCallback((agentId: string, sessionKey: string) => {
    if (!scopeKey || !sessionKey) {
      return false;
    }
    return loadHiddenLiveSessions(scopeKey).some((hiddenSessionKey) => (
      sessionMatchesActiveContext({
        sessionKey: hiddenSessionKey,
        activeSessionKey: sessionKey,
        agentId,
      })
    ));
  }, [scopeKey]);

  const restoreLiveSession = useCallback((agentId: string, sessionKey: string) => {
    if (!scopeKey || !sessionKey) {
      return;
    }
    const nextHiddenSessions = loadHiddenLiveSessions(scopeKey).filter((hiddenSessionKey) => !sessionMatchesActiveContext({
      sessionKey: hiddenSessionKey,
      activeSessionKey: sessionKey,
      agentId,
    }));
    saveHiddenLiveSessions(scopeKey, nextHiddenSessions);
  }, [scopeKey]);

  const ensureDraftThreadForActiveSession = useCallback(() => {
    if (!activeAgentIdRef.current || !activeSessionKeyRef.current) {
      return "";
    }

    const existing = threadsRef.current.find((thread) =>
      thread.agentId === activeAgentIdRef.current &&
      thread.status !== "archived" &&
      sessionMatchesActiveContext({
        sessionKey: thread.sessionKey,
        activeSessionKey: activeSessionKeyRef.current,
        agentId: activeAgentIdRef.current,
      }),
    );
    if (existing) {
      return existing.id;
    }

    const nextThread = createThread({
      agentId: activeAgentIdRef.current,
      sessionKey: activeSessionKeyRef.current,
      status: "draft",
      title: "New chat",
      preview: "Fresh conversation",
    });
    updateThreads((current) => [nextThread, ...current]);
    activeThreadIdRef.current = nextThread.id;
    setActiveThreadId(nextThread.id);
    return nextThread.id;
  }, []);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;

    const updatePosition = () => {
      const hasTranscriptContent = messagesRef.current.length > 0;
      if (!hasTranscriptContent && !activeRunIdRef.current) {
        return;
      }

      const nearBottom = isNearBottom(transcript);
      shouldAutoScrollRef.current = nearBottom;

      if (!activeRunIdRef.current) {
        return;
      }

      if (nearBottom) {
        userPausedStreamFollowRef.current = false;
        streamFollowEnabledRef.current = true;
        return;
      }

      userPausedStreamFollowRef.current = true;
      streamFollowEnabledRef.current = false;
    };

    updatePosition();
    transcript.addEventListener("scroll", updatePosition);
    return () => transcript.removeEventListener("scroll", updatePosition);
  }, [bootstrap]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      pendingScrollBehaviorRef.current = null;
      return;
    }

    const followingStream =
      activeRunIdRef.current &&
      streamFollowEnabledRef.current &&
      !userPausedStreamFollowRef.current &&
      isAssistantStreaming(messages);
    const scrollBehavior = followingStream ? "auto" : pendingScrollBehaviorRef.current;
    const shouldScroll = !!scrollBehavior;

    if (shouldScroll) {
      if (typeof transcript.scrollTo === "function") {
        transcript.scrollTo({ top: transcript.scrollHeight, behavior: scrollBehavior });
        transcript.scrollTop = transcript.scrollHeight;
      } else {
        transcript.scrollTop = transcript.scrollHeight;
      }

      if (followingStream) {
        shouldAutoScrollRef.current = true;
      }
    }

    pendingScrollBehaviorRef.current = null;
  }, [messages]);

  useLayoutEffect(() => {
    if (panelOpen) {
      return;
    }

    const transcript = transcriptRef.current;
    const internalSnapshot = internalReturnScrollSnapshotRef.current;
    const externalSnapshot = returnScrollSnapshot && consumedExternalReturnScrollSnapshotRef.current !== returnScrollSnapshot
      ? returnScrollSnapshot
      : null;
    const snapshot = internalSnapshot ?? externalSnapshot;
    if (!transcript || !snapshot) {
      return;
    }

    if (!activeAgentId || !activeSessionKey || !activeThreadId) {
      return;
    }

    if (internalSnapshot) {
      const sameAgent = snapshot.agentId === activeAgentId;
      if (!sameAgent) {
        clearReturnScrollSnapshots(false);
        return;
      }

      pendingScrollBehaviorRef.current = null;
      transcript.scrollTop = snapshot.scrollTop;
      shouldAutoScrollRef.current = isNearBottom(transcript);
      clearReturnScrollSnapshots(false);
      return;
    }

    const sameSession = sessionMatchesActiveContext({
      sessionKey: snapshot.sessionKey,
      activeSessionKey,
      agentId: snapshot.agentId,
    });
    const sameAgent = snapshot.agentId === activeAgentId;

    if (!sameSession || !sameAgent) {
      clearReturnScrollSnapshots(Boolean(returnScrollSnapshot));
      if (shouldAutoScrollRef.current) {
        transcript.scrollTop = transcript.scrollHeight;
      }
      return;
    }

    pendingScrollBehaviorRef.current = null;
    transcript.scrollTop = snapshot.scrollTop;
    shouldAutoScrollRef.current = isNearBottom(transcript);
    clearReturnScrollSnapshots(Boolean(returnScrollSnapshot));
  }, [
    activeAgentId,
    activeSessionKey,
    activeThreadId,
    bootstrap,
    clearReturnScrollSnapshots,
    hasPendingReturnScrollSnapshot,
    panelOpen,
    returnScrollSnapshot,
  ]);

  function queueScrollToBottom(behavior: ScrollBehavior = "auto") {
    pendingScrollBehaviorRef.current = behavior;
  }

  function prepareNextRunAutoFollow(scrollBehavior: ScrollBehavior = "auto") {
    streamFollowEnabledRef.current = true;
    streamFollowRunIdRef.current = "";
    userPausedStreamFollowRef.current = false;
    shouldAutoScrollRef.current = true;
    queueScrollToBottom(scrollBehavior);
  }

  function beginStreamAutoFollow(runId: string, scrollBehavior: ScrollBehavior = "auto") {
    const nextRunId = runId.trim();
    const isNewRun = streamFollowRunIdRef.current !== nextRunId;

    streamFollowRunIdRef.current = nextRunId;
    if (isNewRun) {
      userPausedStreamFollowRef.current = false;
      shouldAutoScrollRef.current = true;
    }

    if (userPausedStreamFollowRef.current) {
      return;
    }

    streamFollowEnabledRef.current = true;
    queueScrollToBottom(scrollBehavior);
  }

  function endStreamAutoFollow() {
    streamFollowEnabledRef.current = false;
    streamFollowRunIdRef.current = "";
    userPausedStreamFollowRef.current = false;
  }

  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
  }, [activeAgentId]);

  useEffect(() => {
    activeSessionKeyRef.current = activeSessionKey;
  }, [activeSessionKey]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    const wasConfigUpdating = configUpdatingRef.current;
    configUpdatingRef.current = isConfigUpdating;

    if (isConfigUpdating || !wasConfigUpdating) {
      return;
    }

    if (!clientRef.current || connectionState !== "connected" || !activeAgentIdRef.current) {
      return;
    }

    clearHistoryReconcile();
    setShellError("");
    setSendingState(false);
    activeRunIdRef.current = "";
    setActiveRunId("");
    endStreamAutoFollow();
    void refreshSessions(activeAgentIdRef.current, clientRef.current, undefined);
  }, [clearHistoryReconcile, connectionState, isConfigUpdating]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  function clearHistoryReconcile() {
    historyReconcileRef.current = null;
    deferredSessionRefreshRef.current = null;
    pendingSessionListRefreshRef.current = false;
    setReplyRecoveryPending(false);
    if (historyReconcileTimerRef.current !== null) {
      window.clearTimeout(historyReconcileTimerRef.current);
      historyReconcileTimerRef.current = null;
    }
  }

  function clearStreamIdleFinalize() {
    if (streamIdleFinalizeTimerRef.current !== null) {
      window.clearTimeout(streamIdleFinalizeTimerRef.current);
      streamIdleFinalizeTimerRef.current = null;
    }
  }

  async function syncSessionList(agentId: string, client = clientRef.current) {
    if (!client || !agentId) {
      setLiveSessions([]);
      return [];
    }

    const sessionPayload = await client.listSessions(agentId || undefined);
    const nextSessions = (sessionPayload.sessions || []).filter((session) => !isSessionHidden(agentId, session.key));
    setLiveSessions(nextSessions);
    return nextSessions;
  }

  function scheduleHistoryReconcileRetry(
    sessionKey: string,
    threadId: string,
    client: GatewayChatClient,
    sessionSnapshot?: GatewayChatSession | GatewaySessionsChangedPayload | null,
  ) {
    if (historyReconcileTimerRef.current !== null) {
      window.clearTimeout(historyReconcileTimerRef.current);
    }

    historyReconcileTimerRef.current = window.setTimeout(() => {
      historyReconcileTimerRef.current = null;
      void loadHistory(sessionKey, threadId, client, sessionSnapshot);
    }, HISTORY_RECONCILE_INTERVAL_MS);
  }

  useEffect(() => {
    if (!scopeKey) {
      setThreads([]);
      setActiveThreadId("");
      return;
    }
    setThreads(loadStoredThreads(scopeKey));
  }, [scopeKey]);

  useEffect(() => {
    if (!scopeKey) return;
    saveStoredThreads(scopeKey, threads);
  }, [scopeKey, threads]);

  useEffect(() => {
    if (!scopeKey || !activeAgentId || !activeThreadId) return;
    saveStoredSelection(scopeKey, activeAgentId, activeThreadId);
  }, [activeAgentId, activeThreadId, scopeKey]);

  // Re-fetch agent list from the gateway after a config update completes
  const prevConfigUpdating = useRef(false);
  useEffect(() => {
    if (prevConfigUpdating.current && !isConfigUpdating && clientRef.current) {
      void bootstrapShell(clientRef.current);
    }
    prevConfigUpdating.current = isConfigUpdating;
  }, [isConfigUpdating]);

  useEffect(() => {
    const nextMessages = toStoredMessages(messages);
    if (!activeThreadIdRef.current || nextMessages.length === 0) return;

    setThreads((current) =>
      current.map((thread) =>
        thread.id !== activeThreadIdRef.current
          ? thread
          : {
              ...thread,
              messages: nextMessages,
              title: deriveThreadTitle({ messages: nextMessages, fallback: thread.title }),
              preview: deriveThreadPreview({ messages: nextMessages, fallback: thread.preview }),
              updatedAt: nextMessages[nextMessages.length - 1]?.timestamp || Date.now(),
            },
      ),
    );
  }, [messages]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => () => {
    if (historyReconcileTimerRef.current !== null) {
      window.clearTimeout(historyReconcileTimerRef.current);
    }
    if (streamIdleFinalizeTimerRef.current !== null) {
      window.clearTimeout(streamIdleFinalizeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    saveThemePreference(themePreference);
    const mediaQuery =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    const applyTheme = () => {
      setResolvedTheme(resolveThemePreference(themePreference, mediaQuery?.matches ?? false));
    };

    applyTheme();

    if (!mediaQuery) return;

    const listener = () => applyTheme();
    mediaQuery.addEventListener?.("change", listener);
    return () => mediaQuery.removeEventListener?.("change", listener);
  }, [themePreference]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (modifier && e.key === ",") {
        e.preventDefault();
        togglePanel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [togglePanel]);

  function updateThreads(updater: (current: StoredChatThread[]) => StoredChatThread[]) {
    setThreads((current) => updater(current));
  }

  function updateMessageState(updater: (current: ChatMessage[]) => ChatMessage[]) {
    setMessages((current) => {
      const next = updater(current);
      messagesRef.current = next;
      return next;
    });
  }

  function replaceMessageState(next: ChatMessage[]) {
    messagesRef.current = next;
    setMessages(next);
  }

  function setSendingState(next: boolean) {
    sendingRef.current = next;
    setSending(next);
  }

  function ensureLiveThread(params: {
    agentId: string;
    sessionKey: string;
    session?: GatewayChatSession;
    preferredThreadId?: string;
    sessionId?: string;
  }) {
    const existing = threadsRef.current.find(
      (thread) =>
        thread.agentId === params.agentId &&
        sessionMatchesActiveContext({
          sessionKey: thread.sessionKey,
          activeSessionKey: params.sessionKey,
          agentId: params.agentId,
        }) &&
        thread.status !== "archived" &&
        (!params.preferredThreadId || thread.id === params.preferredThreadId),
    );

    if (existing) {
      updateThreads((current) =>
        current.flatMap((thread) => {
          const isDuplicate =
            thread.id !== existing.id &&
            thread.agentId === params.agentId &&
            thread.status !== "archived" &&
            sessionMatchesActiveContext({
              sessionKey: thread.sessionKey,
              activeSessionKey: params.sessionKey,
              agentId: params.agentId,
            });

          if (isDuplicate) {
            return [];
          }

          if (thread.id !== existing.id) {
            return [thread];
          }

          return [{
            ...thread,
            status: "live",
            sessionKey: preferCanonicalSessionKey({
              sessionKey: thread.sessionKey,
              matchedSessionKey: params.sessionKey,
            }),
            sessionId: params.sessionId || params.session?.sessionId || thread.sessionId,
            title: deriveThreadTitle({ session: params.session, messages: thread.messages, fallback: thread.title }),
            preview: deriveThreadPreview({ session: params.session, messages: thread.messages, fallback: thread.preview }),
            updatedAt: params.session?.updatedAt || thread.updatedAt || Date.now(),
          }];
        }),
      );
      return existing.id;
    }

    const nextThread = createThread({
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId || params.session?.sessionId,
      status: params.session ? "live" : "draft",
      session: params.session,
      title: params.session ? formatSessionTitle(params.session) : "New chat",
      preview: params.session?.lastMessagePreview || "Fresh conversation",
    });
    updateThreads((current) => [
      nextThread,
      ...current.filter(
        (thread) =>
          thread.id !== nextThread.id &&
          !(
            thread.agentId === params.agentId &&
            thread.status !== "archived" &&
            sessionMatchesActiveContext({
              sessionKey: thread.sessionKey,
              activeSessionKey: params.sessionKey,
              agentId: params.agentId,
            })
          ),
      ),
    ]);
    return nextThread.id;
  }

  useEffect(() => {
    if (!bootstrap) return;

    const client = new GatewayChatClient(bootstrap);
    clientRef.current = client;

    client.onStateChange = (state) => {
      setConnectionState(state.status);

      if (state.status === "connected") {
        setConnectionLabel(formatOpenClawStatusLabel(bootstrap.openClawVersion));
        setShellError("");
      } else if (state.status === "reconnecting") {
        setConnectionLabel("Reconnecting to gateway...");
      } else if (state.status === "challenged") {
        setConnectionLabel("Authorizing gateway session...");
      } else if (state.status === "authenticating") {
        setConnectionLabel("Authenticating with OpenClaw...");
      } else if (state.status === "failed") {
        const message = state.error || "Gateway connection failed.";
        setConnectionLabel(message);
        setShellError(message);
      } else {
        setConnectionLabel("Connecting to gateway...");
      }
    };

    client.onReady = () => {
      void bootstrapShell(client);
    };

    client.onSeqGap = () => {
      const currentThread = threadsRef.current.find((thread) => thread.id === activeThreadIdRef.current);
      if (activeSessionKeyRef.current && activeThreadIdRef.current && currentThread?.status !== "archived") {
        void loadHistory(activeSessionKeyRef.current, activeThreadIdRef.current, client);
      }
    };

    client.onChatEvent = (event) => {
      handleChatEvent(event);
    };

    client.onAgentEvent = (event) => {
      handleAgentEvent(event);
    };

    client.onSessionsChanged = (payload) => {
      if (!activeAgentIdRef.current) {
        return;
      }

      const terminalSnapshot = isTerminalSessionSnapshot(asSessionLifecycleSnapshot(payload));
      const targetsActiveSession = sessionMatchesActiveContext({
        sessionKey: payload.sessionKey ?? payload.session?.key,
        activeSessionKey: activeSessionKeyRef.current,
        agentId: activeAgentIdRef.current,
      });

      if (
        targetsActiveSession &&
        terminalSnapshot &&
        (activeRunIdRef.current || historyReconcileRef.current || isAssistantStreaming(messagesRef.current) || sendingRef.current)
      ) {
        handleTerminalCompletion({
          runId: activeRunIdRef.current || undefined,
          sessionSnapshot: payload,
          terminalState: payload.abortedLastRun || payload.status === "aborted" ? "aborted" : "final",
        });
        return;
      }

      if (targetsActiveSession && terminalSnapshot) {
        void syncSessionList(activeAgentIdRef.current, client);
        return;
      }

      if (targetsActiveSession && (activeRunIdRef.current || sendingRef.current) && !terminalSnapshot) {
        clearStreamIdleFinalize();
        streamIdleFinalizeTimerRef.current = window.setTimeout(() => {
          streamIdleFinalizeTimerRef.current = null;
          const visibleAssistantRunId = [...messagesRef.current]
            .reverse()
            .find((message) =>
              message.role === "assistant" &&
              !!sanitizeAssistantTranscriptText(message.rawText || message.text).trim(),
            )?.runId;
          const completionRunId = activeRunIdRef.current || visibleAssistantRunId;
          if (
            completionRunId &&
            runHasVisibleAssistantMessage(messagesRef.current, completionRunId) &&
            !historyReconcileRef.current
          ) {
            handleTerminalCompletion({
              runId: completionRunId,
              sessionSnapshot: payload,
              terminalState: "final",
            });
          }
        }, 150);
        deferredSessionRefreshRef.current = payload;
        return;
      }

      if (targetsActiveSession && historyReconcileRef.current) {
        deferredSessionRefreshRef.current = payload;
        return;
      }

      void refreshSessions(activeAgentIdRef.current, client, activeThreadIdRef.current || undefined, payload);
    };

    void (async () => {
      try {
        await client.connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setConnectionState("failed");
        setConnectionLabel(message);
        setShellError(message);
      }
    })();

    return () => {
      client.disconnect();
      if (clientRef.current === client) {
        clientRef.current = null;
      }
    };
  }, [bootstrap, scopeKey]);

  async function bootstrapShell(client: GatewayChatClient) {
    try {
      setShellError("");
      clearHistoryReconcile();
      const agentPayload = await client.listAgents();
      const nextAgents = agentPayload.agents || [];
      setAgents(nextAgents);

      const preferredAgentId =
        chatActiveAgentId && nextAgents.some((agent) => agent.id === chatActiveAgentId)
          ? chatActiveAgentId
          : "";
      const nextAgentId = preferredAgentId || agentPayload.defaultId || nextAgents[0]?.id || "";
      setActiveAgentId(nextAgentId);
      if (nextAgentId && nextAgentId !== chatActiveAgentId) {
        onAgentSwitch?.(nextAgentId);
      }
      setMessages([]);
      setReplyRecoveryPending(false);
      activeRunIdRef.current = "";
      setActiveRunId("");
      endStreamAutoFollow();

      if (!nextAgentId) {
        setLiveSessions([]);
        setActiveSessionKey("");
        return;
      }

      await refreshSessions(nextAgentId, client, loadStoredSelection(scopeKey, nextAgentId) || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setShellError(message);
      setConnectionLabel(message);
    }
  }

  async function refreshSessions(
    agentId: string,
    client = clientRef.current,
    preferredThreadId?: string,
    sessionChange?: GatewaySessionsChangedPayload,
  ) {
    if (!client || !agentId) {
      setLiveSessions([]);
      setActiveSessionKey("");
      setMessages([]);
      setReplyRecoveryPending(false);
      endStreamAutoFollow();
      return;
    }

    const sessionPayload = await client.listSessions(agentId || undefined);
    const nextSessions = (sessionPayload.sessions || []).filter((session) => !isSessionHidden(agentId, session.key));
    setLiveSessions(nextSessions);

    const desiredThreadId = preferredThreadId || loadStoredSelection(scopeKey, agentId) || "";
    const desiredThread = threadsRef.current.find((thread) => thread.id === desiredThreadId && thread.agentId === agentId);
    const desiredSessionKey = resolveSessionKeyForAgent({
      agentId,
      liveSessions: nextSessions,
      preferredSessionKey: desiredThread?.status !== "archived" ? desiredThread?.sessionKey : undefined,
    });
    const matchedSession =
      nextSessions.find((session) =>
        sessionMatchesActiveContext({
          sessionKey: session.key,
          activeSessionKey: desiredSessionKey,
          agentId,
        }),
      ) || null;
    const resolvedSessionKey = preferCanonicalSessionKey({
      sessionKey: desiredSessionKey,
      matchedSessionKey: matchedSession?.key,
    });
    const matchedSessionChange =
      sessionChange &&
      sessionMatchesActiveContext({
        sessionKey: sessionChange.sessionKey ?? sessionChange.session?.key,
        activeSessionKey: resolvedSessionKey,
        agentId,
      })
        ? sessionChange
        : null;
    const nextThreadId = ensureLiveThread({
      agentId,
      sessionKey: resolvedSessionKey,
      session: matchedSession || undefined,
      preferredThreadId: desiredThread?.status === "archived" ? undefined : desiredThread?.id,
      sessionId: matchedSession?.sessionId || matchedSessionChange?.sessionId || desiredThread?.sessionId,
    });

    setActiveThreadId(nextThreadId);
    setActiveSessionKey(resolvedSessionKey);

    const selectedThread =
      threadsRef.current.find((thread) => thread.id === nextThreadId) ||
      createThread({ agentId, sessionKey: resolvedSessionKey, status: matchedSession ? "live" : "draft" });

    if (matchedSession) {
      await loadHistory(resolvedSessionKey, nextThreadId, client, matchedSessionChange || matchedSession);
      return;
    }

    if (matchedSessionChange && isTerminalSessionSnapshot(asSessionLifecycleSnapshot(matchedSessionChange))) {
      await loadHistory(resolvedSessionKey, nextThreadId, client, matchedSessionChange);
      return;
    }

    queueScrollToBottom("auto");
    replaceMessageState(
      selectedThread.messages.map((message) => ({
        ...message,
      })),
    );
  }

  async function loadHistory(
    sessionKey: string,
    threadId: string,
    client = clientRef.current,
    sessionSnapshot?: GatewayChatSession | GatewaySessionsChangedPayload | null,
  ) {
    if (!client || !sessionKey) return;
    setLoadingHistory(true);
    try {
      const terminalSnapshot = asSessionLifecycleSnapshot(sessionSnapshot);
      const activeRunMatchesSession =
        sessionMatchesActiveContext({
          sessionKey,
          activeSessionKey: activeSessionKeyRef.current,
          agentId: activeAgentIdRef.current,
        }) &&
        !!activeRunIdRef.current;
      const shouldDeferActiveRunHistory =
        activeRunMatchesSession &&
        !historyReconcileRef.current &&
        !isTerminalSessionSnapshot(terminalSnapshot);

      if (shouldDeferActiveRunHistory) {
        return;
      }

      const payload = await client.loadHistory(sessionKey);
      const nextMessages = toChatMessages(payload.messages);
      const pendingReconcile = historyReconcileRef.current;
      const shouldPreserveLocalMessages =
        !!pendingReconcile &&
        pendingReconcile.sessionKey === sessionKey &&
        pendingReconcile.threadId === threadId &&
        !historyContainsRecentTail(nextMessages, pendingReconcile.tail);

      if (shouldPreserveLocalMessages) {
        queueScrollToBottom("auto");
        const timedOut = Date.now() - pendingReconcile.startedAt >= MAX_HISTORY_RECONCILE_MS;
        if (timedOut) {
          clearHistoryReconcile();
          replaceMessageState(
            replacePendingAssistantWithRecoveryNotice(messagesRef.current, pendingReconcile.runId),
          );
          void syncSessionList(activeAgentIdRef.current, client);
          return;
        }

        historyReconcileRef.current = {
          ...pendingReconcile,
          retries: pendingReconcile.retries + 1,
        };
        scheduleHistoryReconcileRetry(sessionKey, threadId, client, sessionSnapshot);
        return;
      }

      if (pendingReconcile?.sessionKey === sessionKey && pendingReconcile.threadId === threadId) {
        clearHistoryReconcile();
      }
      const latestMessage = nextMessages[nextMessages.length - 1];
      const shouldFinalizeActiveRun =
        sessionMatchesActiveContext({
          sessionKey,
          activeSessionKey: activeSessionKeyRef.current,
          agentId: activeAgentIdRef.current,
        }) &&
        !!activeRunIdRef.current &&
        (latestMessage?.role === "assistant" || isTerminalSessionSnapshot(terminalSnapshot));

      const shouldFollowToBottom =
        shouldFinalizeActiveRun || (
          shouldAutoScrollRef.current &&
          !hasPendingReturnScrollSnapshot()
        );

      if (shouldFollowToBottom) {
        queueScrollToBottom("auto");
      }
      replaceMessageState(nextMessages);
      if (shouldFinalizeActiveRun) {
        activeRunIdRef.current = "";
        setActiveRunId("");
        setSendingState(false);
        endStreamAutoFollow();
      }
      if (
        pendingSessionListRefreshRef.current &&
        sessionMatchesActiveContext({
          sessionKey,
          activeSessionKey: activeSessionKeyRef.current,
          agentId: activeAgentIdRef.current,
        })
      ) {
        pendingSessionListRefreshRef.current = false;
        deferredSessionRefreshRef.current = null;
        void syncSessionList(activeAgentIdRef.current, client);
      }
      updateThreads((current) =>
        current.map((thread) =>
          thread.id !== threadId
            ? thread
            : {
                ...thread,
                status: "live",
                sessionId: payload.sessionId || thread.sessionId,
                messages: toStoredMessages(nextMessages),
                title: deriveThreadTitle({ messages: toStoredMessages(nextMessages), fallback: thread.title }),
                preview: deriveThreadPreview({ messages: toStoredMessages(nextMessages), fallback: thread.preview }),
                updatedAt: Date.now(),
              },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missingSession = /not found|unknown session|key required/i.test(message);
      if (missingSession) {
        clearHistoryReconcile();
        queueScrollToBottom("auto");
        replaceMessageState([]);
        setReplyRecoveryPending(false);
        updateThreads((current) =>
          current.map((thread) =>
            thread.id !== threadId
              ? thread
              : {
                  ...thread,
                  status: "draft",
                  sessionId: undefined,
                  messages: [],
                  preview: "Fresh conversation",
                },
          ),
        );
      } else {
        setShellError(message);
      }
    } finally {
      setLoadingHistory(false);
    }
  }

  function handleTerminalCompletion(params: {
    runId?: string | null;
    sessionSnapshot?: GatewayChatSession | GatewaySessionsChangedPayload | null;
    terminalState: "final" | "aborted";
  }) {
    const runId = params.runId ?? activeRunIdRef.current ?? undefined;
    if (runId) {
      settledRunIdsRef.current = [...settledRunIdsRef.current.filter((id) => id !== runId), runId].slice(-50);
    }

    const sessionKey = activeSessionKeyRef.current;
    const threadId = activeThreadIdRef.current;
    const threadMessages = threadId
      ? (threadsRef.current.find((thread) => thread.id === threadId)?.messages || []).map((message) => ({ ...message }))
      : [];
    const currentMessages = messagesRef.current.length > 0 ? messagesRef.current : threadMessages;
    const reconcileTail = buildReconcileTail(currentMessages, runId);
    const requiresVisibleAssistantSync =
      params.terminalState === "final" &&
      reconcileTail.some((entry) => entry.role === "assistant" && entry.requireVisibleText) &&
      !runHasVisibleAssistantMessage(currentMessages, runId);
    if (requiresVisibleAssistantSync && sessionKey && threadId && clientRef.current) {
      historyReconcileRef.current = {
        sessionKey,
        threadId,
        tail: reconcileTail,
        runId: runId || undefined,
        retries: 0,
        startedAt: Date.now(),
        requiresVisibleAssistant: true,
      };
      pendingSessionListRefreshRef.current = true;
      replaceMessageState(
        currentMessages.map((message) => (
          runId && message.runId === runId ? { ...message, pending: true } : message
        )),
      );
      setReplyRecoveryPending(true);
      activeRunIdRef.current = "";
      setActiveRunId("");
      setSendingState(false);
      endStreamAutoFollow();
      void loadHistory(sessionKey, threadId, clientRef.current, params.sessionSnapshot);
      return;
    }

    clearHistoryReconcile();
    replaceMessageState(finalizeRunMessages(currentMessages, runId));
    activeRunIdRef.current = "";
    setActiveRunId("");
    setSendingState(false);
    endStreamAutoFollow();
    void syncSessionList(activeAgentIdRef.current, clientRef.current || undefined);
  }

  function maybeCompleteDeferredVisibleReply(runId: string) {
    const deferredRefresh = deferredSessionRefreshRef.current;
    if (
      !deferredRefresh ||
      !sessionMatchesActiveContext({
        sessionKey: deferredRefresh.sessionKey ?? deferredRefresh.session?.key,
        activeSessionKey: activeSessionKeyRef.current,
        agentId: activeAgentIdRef.current,
      }) ||
      !runHasVisibleAssistantMessage(messagesRef.current, runId)
    ) {
      return;
    }

    clearStreamIdleFinalize();
    handleTerminalCompletion({
      runId,
      sessionSnapshot: deferredRefresh,
      terminalState: "final",
    });
  }

  function handleChatEvent(event: GatewayChatEventPayload) {
    if (!sessionMatchesActiveContext({
      sessionKey: event.sessionKey,
      activeSessionKey: activeSessionKeyRef.current,
      agentId: activeAgentIdRef.current,
    })) {
      return;
    }

    if (event.errorMessage) {
      clearStreamIdleFinalize();
      queueScrollToBottom("auto");
      updateMessageState((current) => [
        ...current,
        { id: `error-${Date.now()}`, role: "system", text: event.errorMessage || "Gateway error.", error: true },
      ]);
      setReplyRecoveryPending(false);
      activeRunIdRef.current = "";
      setActiveRunId("");
      setSendingState(false);
      endStreamAutoFollow();
      return;
    }

    if (event.state === "final" || event.state === "aborted") {
      clearStreamIdleFinalize();
      handleTerminalCompletion({
        runId: event.runId,
        terminalState: event.state,
      });
    }
  }

  function handleAgentEvent(event: GatewayAgentEventPayload) {
    if (!event.runId || event.stream !== "assistant") return;
    const delta = typeof event.data.text === "string" ? event.data.text : "";
    if (!delta) return;
    clearStreamIdleFinalize();
    beginStreamAutoFollow(event.runId, "auto");

    updateMessageState((current) => {
      const existingIndex = current.findIndex((message) => message.runId === event.runId);
      if (existingIndex >= 0) {
        return current.map((message, index) => {
          if (index !== existingIndex) {
            return message;
          }

          const rawText = mergeAssistantStreamText(message.rawText || message.text, delta);
          return {
            ...message,
            rawText,
            text: sanitizeAssistantTranscriptText(rawText),
            pending: true,
          };
        });
      }

      const placeholderIndex = current.findIndex((message) => (
        message.role === "assistant" &&
        message.pending &&
        !message.runId &&
        !sanitizeAssistantTranscriptText(message.rawText || message.text).trim()
      ));
      if (placeholderIndex >= 0) {
        const rawText = delta;
        return current.map((message, index) => (
          index !== placeholderIndex
            ? message
            : {
                ...message,
                id: `assistant-${event.runId}`,
                runId: event.runId,
                rawText,
                text: sanitizeAssistantTranscriptText(rawText),
                pending: true,
              }
        ));
      }

      const rawText = delta;
      return [
        ...current,
        {
          id: `assistant-${event.runId}`,
          role: "assistant",
          text: sanitizeAssistantTranscriptText(rawText),
          rawText,
          runId: event.runId,
          pending: true,
        },
      ];
    });
  }

  async function handleAgentSwitch(agentId: string) {
    if (!agentId || agentId === activeAgentId) return;
    clearHistoryReconcile();
    setActiveAgentId(agentId);
    onAgentSwitch?.(agentId);
    setLiveSessions([]);
    setActiveSessionKey("");
    setActiveThreadId("");
    replaceMessageState([]);
    setReplyRecoveryPending(false);
    activeRunIdRef.current = "";
    setActiveRunId("");
    endStreamAutoFollow();
    await refreshSessions(agentId);
  }

  async function handleAgentRemove(agentId: string) {
    if (!agentId || agentId === "main") return;
    clearHistoryReconcile();
    setActiveAgentId("main");
    onAgentSwitch?.("main");
    setLiveSessions([]);
    setActiveSessionKey("");
    setActiveThreadId("");
    replaceMessageState([]);
    setReplyRecoveryPending(false);
    activeRunIdRef.current = "";
    setActiveRunId("");
    endStreamAutoFollow();
    await onRemoveAgent?.(agentId);
    await refreshSessions("main");
  }

  async function handleThreadSwitch(threadId: string) {
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) return;
    clearHistoryReconcile();
    setActiveThreadId(threadId);
    setActiveSessionKey(thread.sessionKey);
    setShellError("");
    setReplyRecoveryPending(false);

    if (thread.status === "archived") {
      endStreamAutoFollow();
      queueScrollToBottom("auto");
      replaceMessageState(
        thread.messages.map((message) => ({
          ...message,
        })),
      );
      return;
    }

    await loadHistory(thread.sessionKey, thread.id);
  }

  async function handleNewChat() {
    if (isConfigUpdating || !clientRef.current || !activeAgentId || !activeSessionKey || connectionState !== "connected") return;
    clearHistoryReconcile();
    restoreLiveSession(activeAgentId, activeSessionKey);

    const currentThreadId = activeThreadId || ensureDraftThreadForActiveSession();

    const archivedMessages = toStoredMessages(messages);
    const freshThread = createThread({
      agentId: activeAgentId,
      sessionKey: activeSessionKey,
      status: "live",
      title: "New chat",
      preview: "Fresh conversation",
    });

    updateThreads((current) =>
      current.flatMap((thread) => {
        if (thread.id !== currentThreadId) {
          return [thread];
        }
        const archivedThread = {
          ...thread,
          status: "archived" as const,
          messages: archivedMessages.length > 0 ? archivedMessages : thread.messages,
          title: deriveThreadTitle({ messages: archivedMessages, fallback: thread.title }),
          preview: deriveThreadPreview({ messages: archivedMessages, fallback: thread.preview }),
          updatedAt: Date.now(),
        };
        return [freshThread, archivedThread];
      }),
    );

    activeThreadIdRef.current = freshThread.id;
    setActiveThreadId(freshThread.id);
    prepareNextRunAutoFollow("auto");
    replaceMessageState([]);
    setShellError("");
    setSendingState(true);
    setReplyRecoveryPending(false);
    updateMessageState((current) => ensurePendingAssistantPlaceholder(current));

    try {
      const result = await clientRef.current.sendChat(activeSessionKey, "/new", "adaptive");
      if (!sendingRef.current && !activeRunIdRef.current) {
        settledRunIdsRef.current = [...settledRunIdsRef.current.filter((id) => id !== result.runId), result.runId].slice(-50);
        if (historyReconcileRef.current && !historyReconcileRef.current.runId) {
          historyReconcileRef.current = { ...historyReconcileRef.current, runId: result.runId };
        }
        return;
      }
      activeRunIdRef.current = result.runId;
      setActiveRunId(result.runId);
      beginStreamAutoFollow(result.runId, "auto");
      updateMessageState((current) => {
        if (settledRunIdsRef.current.includes(result.runId)) {
          return current;
        }
        return ensurePendingAssistantMessage(attachPendingAssistantRunId(current, result.runId), result.runId);
      });
      maybeCompleteDeferredVisibleReply(result.runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSendingState(false);
      setReplyRecoveryPending(false);
      endStreamAutoFollow();
      replaceMessageState(removePendingAssistantPlaceholder(messagesRef.current));
      setShellError(`Failed to start a fresh chat: ${message}`);
    }
  }

  async function handleSend() {
    const text = composerValue.trim();
    if (
      isConfigUpdating ||
      !text ||
      !clientRef.current ||
      !activeSessionKey ||
      connectionState !== "connected" ||
      activeThreadIsArchived
    ) {
      return;
    }

    if (text === "/stop") {
      setComposerValue("");
      await handleAbort();
      return;
    }

    if (sending || replyRecoveryPending) {
      return;
    }

    clearHistoryReconcile();
    restoreLiveSession(activeAgentId, activeSessionKey);
    const ensuredThreadId = activeThreadId || ensureDraftThreadForActiveSession();
    setComposerValue("");
    setSendingState(true);
    setReplyRecoveryPending(false);
    prepareNextRunAutoFollow("auto");
    updateMessageState((current) =>
      ensurePendingAssistantPlaceholder([
        ...current,
        { id: `user-${Date.now()}`, role: "user", text, timestamp: Date.now() },
      ]),
    );

    if (ensuredThreadId && activeThreadIdRef.current !== ensuredThreadId) {
      activeThreadIdRef.current = ensuredThreadId;
    }

    try {
      const result = await clientRef.current.sendChat(activeSessionKey, text, "adaptive");
      if (!sendingRef.current && !activeRunIdRef.current) {
        settledRunIdsRef.current = [...settledRunIdsRef.current.filter((id) => id !== result.runId), result.runId].slice(-50);
        if (historyReconcileRef.current && !historyReconcileRef.current.runId) {
          historyReconcileRef.current = { ...historyReconcileRef.current, runId: result.runId };
        }
        return;
      }
      activeRunIdRef.current = result.runId;
      setActiveRunId(result.runId);
      beginStreamAutoFollow(result.runId, "auto");
      updateMessageState((current) => {
        if (settledRunIdsRef.current.includes(result.runId)) {
          return current;
        }
        return ensurePendingAssistantMessage(attachPendingAssistantRunId(current, result.runId), result.runId);
      });
      maybeCompleteDeferredVisibleReply(result.runId);
    } catch (error) {
      setSendingState(false);
      setReplyRecoveryPending(false);
      endStreamAutoFollow();
      queueScrollToBottom("auto");
      updateMessageState((current) => [
        ...removePendingAssistantPlaceholder(current),
        { id: `error-${Date.now()}`, role: "system", text: String(error), error: true },
      ]);
    }
  }

  async function handleAbort() {
    if (isConfigUpdating || !clientRef.current || !activeRunId || !activeSessionKey || connectionState !== "connected") return;
    clearHistoryReconcile();
    const runId = activeRunId;

    setSendingState(false);
    setReplyRecoveryPending(false);
    activeRunIdRef.current = "";
    setActiveRunId("");
    endStreamAutoFollow();
    updateMessageState((current) =>
      current.map((message) => (message.runId === runId ? { ...message, pending: false } : message)),
    );

    try {
      await clientRef.current.abortChat(activeSessionKey, runId);
    } catch (error) {
      setShellError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleResetChat() {
    if (isConfigUpdating || !clientRef.current || !activeSessionKey || connectionState !== "connected" || activeThreadIsArchived) return;
    clearHistoryReconcile();
    restoreLiveSession(activeAgentId, activeSessionKey);
    ensureDraftThreadForActiveSession();
    prepareNextRunAutoFollow("auto");
    replaceMessageState([]);
    setSendingState(true);
    setReplyRecoveryPending(false);
    setShellError("");
    updateMessageState((current) => ensurePendingAssistantPlaceholder(current));
    try {
      const result = await clientRef.current.sendChat(activeSessionKey, "/reset", "adaptive");
      if (!sendingRef.current && !activeRunIdRef.current) {
        settledRunIdsRef.current = [...settledRunIdsRef.current.filter((id) => id !== result.runId), result.runId].slice(-50);
        if (historyReconcileRef.current && !historyReconcileRef.current.runId) {
          historyReconcileRef.current = { ...historyReconcileRef.current, runId: result.runId };
        }
        return;
      }
      activeRunIdRef.current = result.runId;
      setActiveRunId(result.runId);
      beginStreamAutoFollow(result.runId, "auto");
      updateMessageState((current) => {
        if (settledRunIdsRef.current.includes(result.runId)) {
          return current;
        }
        return ensurePendingAssistantMessage(attachPendingAssistantRunId(current, result.runId), result.runId);
      });
      maybeCompleteDeferredVisibleReply(result.runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSendingState(false);
      setReplyRecoveryPending(false);
      replaceMessageState(removePendingAssistantPlaceholder(messagesRef.current));
      setShellError(`Failed to reset chat: ${message}`);
    }
  }

  const gatewayConnected = connectionState === "connected";
  const chatReady = !!bootstrap && !bootstrapping && gatewayConnected && !isConfigUpdating;
  const canCreateChat = chatReady && !!activeAgentId && !!activeSessionKey;
  const canSend =
    chatReady && !!activeAgentId && !!activeSessionKey && !!composerValue.trim() && !sending && !replyRecoveryPending && !activeThreadIsArchived;
  const activeAgentName = agents.find((agent) => agent.id === activeAgentId)?.name || activeAgentId;
  const showEmptyAgentState = gatewayConnected && agents.length === 0;
  const showConnectingState =
    !isConfigUpdating && (
      connectionState === "connecting" ||
      connectionState === "challenged" ||
      connectionState === "authenticating" ||
      connectionState === "reconnecting"
    );

  const agentThreads = threads
    .filter((thread) => thread.agentId === activeAgentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const liveThreads = agentThreads.filter((thread) => thread.status !== "archived");
  const archivedThreads = agentThreads.filter((thread) => thread.status === "archived");

  async function handleDeleteThread(threadId: string) {
    const thread = threadsRef.current.find((candidate) => candidate.id === threadId);
    if (!thread) {
      return;
    }

    clearHistoryReconcile();
    if (scopeKey) {
      removeStoredSelection(scopeKey, thread.agentId, thread.id);
      if (thread.status !== "archived") {
        hideLiveSession(scopeKey, thread.sessionKey);
      }
    }

    const remainingThreads = threadsRef.current
      .filter((candidate) => candidate.id !== threadId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    updateThreads(() => remainingThreads);

    if (activeThreadIdRef.current !== threadId) {
      return;
    }

    const nextThread = remainingThreads.find((candidate) => candidate.agentId === thread.agentId) || null;
    activeRunIdRef.current = "";
    setActiveRunId("");
    setSendingState(false);
    endStreamAutoFollow();

    if (!nextThread) {
      activeThreadIdRef.current = "";
      setActiveThreadId("");
      setMessages([]);
      setShellError("");
      if (thread.status === "archived") {
        const fallbackSessionKey = resolveSessionKeyForAgent({
          agentId: thread.agentId,
          liveSessions,
          preferredSessionKey: activeSessionKeyRef.current || thread.sessionKey,
        });
        activeSessionKeyRef.current = fallbackSessionKey;
        setActiveSessionKey(fallbackSessionKey);
      }
      return;
    }

    activeThreadIdRef.current = nextThread.id;
    activeSessionKeyRef.current = nextThread.sessionKey;
    setActiveThreadId(nextThread.id);
    setActiveSessionKey(nextThread.sessionKey);
    setShellError("");

    if (nextThread.status === "archived") {
      setMessages(nextThread.messages.map((message) => ({ ...message })));
      return;
    }

    await loadHistory(nextThread.sessionKey, nextThread.id);
  }

  const panelContextValue = {
    panelOpen,
    panelView,
    setPanelOpen,
    setPanelView,
    openPanel,
    closePanel,
  };

  const activeDisplayAgent = displayAgents.find((a) => a.id === activeAgentId) || null;

  // Resolve per-agent config: when a non-main agent is selected, use its config from propAgents
  const activeAgentConfig = activeAgentId && activeAgentId !== "main" && propAgents
    ? propAgents.find(a => a.id === activeAgentId) ?? null
    : null;

  // Per-agent overrides (fall back to top-level props when no agent-specific config exists)
  const resolvedModelRef = activeAgentConfig?.model ?? agentModelRef;
  const resolvedFallbackModels = activeAgentConfig?.fallbackModels ?? agentFallbackModels;
  const resolvedSkills = activeAgentConfig?.skills ?? agentSkills;
  const resolvedIdentityMd = activeAgentConfig?.identityMd ?? identityMd;
  const resolvedSoulMd = activeAgentConfig?.soulMd ?? soulMd;
  const resolvedToolsMd = activeAgentConfig?.toolsMd ?? toolsMd;
  const resolvedAgentsMd = activeAgentConfig?.agentsMd ?? agentsMd;
  const resolvedHeartbeatMd = activeAgentConfig?.heartbeatMd ?? heartbeatMd;
  const resolvedMemoryMd = activeAgentConfig?.memoryMd ?? memoryMd;
  const resolvedToolPolicy = activeAgentConfig?.toolPolicy ?? toolPolicy;
  const resolvedSandboxMode = activeAgentConfig?.sandboxMode ?? sandboxMode;
  const resolvedHeartbeatMode = activeAgentConfig?.heartbeatMode ?? heartbeatMode;
  const resolvedIdleTimeoutMs = activeAgentConfig?.idleTimeoutMs ?? idleTimeoutMs;

  if (panelOpen) {
    return (
      <ChatPanelContext.Provider value={panelContextValue}>
        <div className="chat-shell-fullpanel" data-theme={resolvedTheme}>
          <RightPanel
            activeAgentName={activeDisplayAgent?.name || activeAgentId}
            activeAgentEmoji={activeDisplayAgent && "emoji" in activeDisplayAgent ? String(activeDisplayAgent.emoji || "") || undefined : undefined}
            modelRef={resolvedModelRef}
            fallbackModels={resolvedFallbackModels}
            skills={resolvedSkills}
            onModelChange={onModelChange}
            onFallbacksChange={onFallbacksChange}
            providerAuths={providerAuths}
            onProviderAuthChange={onProviderAuthChange}
            onStartOAuth={onStartOAuth}
            onDetectLocalModels={onDetectLocalModels}
            activeSkills={resolvedSkills}
            serviceKeys={serviceKeys}
            onSaveSkillsConfig={onSaveSkillsConfig}
            skillsSaving={skillsSaving}
            onSetupIntegration={onSetupIntegration}
            identityMd={resolvedIdentityMd}
            soulMd={resolvedSoulMd}
            toolsMd={resolvedToolsMd}
            agentsMd={resolvedAgentsMd}
            heartbeatMd={resolvedHeartbeatMd}
            memoryMd={resolvedMemoryMd}
            onIdentitySave={onIdentitySave}
            identitySaving={identitySaving}
            targetEnvironment={targetEnvironment}
            remoteSummary={remoteSummary}
            gatewayPort={gatewayPort}
            gatewayBind={gatewayBind}
            gatewayAuthMode={gatewayAuthMode}
            heartbeatMode={resolvedHeartbeatMode}
            sandboxMode={resolvedSandboxMode}
            toolPolicy={resolvedToolPolicy}
            toolsSaving={toolsSaving}
            idleTimeoutMs={resolvedIdleTimeoutMs}
            onSaveToolPolicy={onSaveToolPolicy}
            onSaveAdvancedSettings={onSaveAdvancedSettings}
            settingsBusy={settingsBusy}
            maintenanceStatus={maintenanceStatus}
            onRepair={onRepair}
            onAudit={onAudit}
            onUpgrade={onUpgrade}
            onReconfigure={onReconfigure}
            onUninstall={onUninstall}
          />
        </div>
      </ChatPanelContext.Provider>
    );
  }

  return (
    <ChatPanelContext.Provider value={panelContextValue}>
      <div className="chat-shell" data-theme={resolvedTheme}>
        <ChatSidebar
          environments={environments}
          activeEnvironmentId={activeEnvironmentId}
          onSwitchEnvironment={onSwitchEnvironment}
          onAddEnvironment={onAddEnvironment}
          onRemoveEnvironment={onRemoveEnvironment}
          canCreateChat={canCreateChat}
          onNewChat={() => void handleNewChat()}
          liveThreads={liveThreads}
          archivedThreads={archivedThreads}
          activeThreadId={activeThreadId}
          onThreadSwitch={(threadId) => void handleThreadSwitch(threadId)}
          onDeleteThread={(threadId) => void handleDeleteThread(threadId)}
          themePreference={themePreference}
          onThemeChange={setThemePreference}
          onOpenConfigure={() => onOpenConfigure(captureTranscriptScrollSnapshot())}
          onOpenPanel={(view) => openPanel(view as PanelView)}
          connectionLabel={connectionLabel}
        />

        <section className="chat-main-panel">
          <ChatHeader
            agents={displayAgents}
            activeAgentId={activeAgentId}
            activeAgentName={activeAgentName}
            activeSessionKey={activeSessionKey}
            activeThreadIsArchived={activeThreadIsArchived}
            gatewayConnected={gatewayConnected}
            chatReady={chatReady}
            showEmptyAgentState={showEmptyAgentState}
            onAgentSwitch={(agentId) => void handleAgentSwitch(agentId)}
            onAddAgent={onAddAgent}
            onRemoveAgent={(agentId) => void handleAgentRemove(agentId)}
            providerAuths={providerAuths}
            onProviderAuthChange={onProviderAuthChange}
            onStartOAuth={onStartOAuth}
            onDetectLocalModels={onDetectLocalModels}
            onResetChat={() => void handleResetChat()}
            onRetryConnection={onRetryConnection}
            modelRef={resolvedModelRef}
            fallbackCount={resolvedFallbackModels?.length ?? agentFallbackCount}
            onOpenModelPanel={() => openPanel("model")}
          />

          {!bootstrap && (
            <div className="chat-bootstrap-status">
              <p className="chat-bootstrap-title">Starting the gateway workspace</p>
              <p className="chat-bootstrap-detail">{bootstrapping ? "Preparing the OpenClaw gateway connection..." : bootstrapError || "No gateway connection available."}</p>
              {!bootstrapping && <button onClick={onRetryConnection}>Retry</button>}
            </div>
          )}

          {bootstrap && (
            <>
              <ChatTranscript
                transcriptRef={transcriptRef}
                transcriptEndRef={transcriptEndRef}
                showConnectingState={showConnectingState}
                isConfigUpdating={isConfigUpdating}
                connectionLabel={connectionLabel}
                shellError={shellError}
                showEmptyAgentState={showEmptyAgentState}
                loadingHistory={loadingHistory}
                messages={messages}
                activeAgentName={activeAgentName}
                activeThreadIsArchived={activeThreadIsArchived}
                activeThreadTitle={activeThread?.title}
                activeSessionKey={activeSessionKey}
                onSetComposerValue={setComposerValue}
              />

              <ChatComposer
                composerValue={composerValue}
                onComposerChange={setComposerValue}
                onSend={() => void handleSend()}
                onAbort={() => void handleAbort()}
                canSend={canSend}
                chatReady={chatReady}
                activeAgentId={activeAgentId}
                activeAgentName={activeAgentName}
                activeThreadIsArchived={activeThreadIsArchived}
                sending={sending}
                activeRunId={activeRunId}
              />
            </>
          )}
        </section>

      </div>
    </ChatPanelContext.Provider>
  );
}

export default memo(ChatShell);
