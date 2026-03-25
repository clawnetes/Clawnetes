import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { AgentConfigData, GatewayChatBootstrap, ProviderAuthConfig, ToolPolicy } from "../../types";
import {
  GatewayChatClient,
  type GatewayAgentEventPayload,
  type GatewayChatAgent,
  type GatewayConnectState,
  type GatewayChatEventPayload,
  type GatewayChatSession,
} from "../../lib/gatewayChat";
import {
  buildChatScopeKey,
  inferDocumentTheme,
  loadSavedThemePreference,
  loadStoredSelection,
  loadStoredThreads,
  resolveThemePreference,
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

import ChatPanelContext, { type PanelView } from "../../context/ChatPanelContext";
import ChatSidebar from "./ChatSidebar";
import type { StoredEnvironment } from "./ChatSidebar";
import ChatHeader from "./ChatHeader";
import ChatTranscript from "./ChatTranscript";
import ChatComposer from "./ChatComposer";
import RightPanel from "../panel/RightPanel";

export type { StoredEnvironment };

interface ChatShellProps {
  bootstrap: GatewayChatBootstrap | null;
  bootstrapping: boolean;
  bootstrapError: string;
  onRetryConnection: () => void;
  onOpenConfigure: () => void;
  environments?: StoredEnvironment[];
  activeEnvironmentId?: string | null;
  onSwitchEnvironment?: (envId: string) => void;
  onAddEnvironment?: () => void;
  activeAgentId?: string;
  agentModelRef?: string;
  agentFallbackCount?: number;
  agentFallbackModels?: string[];
  agentSkills?: string[];
  serviceKeys?: Record<string, string>;
  onModelChange?: (model: string) => void;
  onFallbacksChange?: (models: string[]) => void;
  providerAuths?: Record<string, ProviderAuthConfig>;
  onProviderAuthChange?: (provider: string, auth: ProviderAuthConfig) => void;
  onStartOAuth?: (provider: string, authMethod: string, oauthProviderId: string) => Promise<ProviderAuthConfig>;
  onDetectLocalModels?: (provider: "ollama" | "lmstudio" | "local", baseUrl?: string) => Promise<string[]>;
  onSaveSkillsConfig?: (skills: string[], serviceKeys: Record<string, string>) => void;
  skillsSaving?: boolean;
  onSetupIntegration?: (skillId: string) => void;
  onAddAgent?: (agent: AgentConfigData) => void | Promise<void>;
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

function ChatShell({
  bootstrap, bootstrapping, bootstrapError, onRetryConnection, onOpenConfigure,
  environments, activeEnvironmentId, onSwitchEnvironment, onAddEnvironment,
  activeAgentId: chatActiveAgentId,
  agentModelRef, agentFallbackCount, agentFallbackModels, agentSkills, serviceKeys,
  onModelChange, onFallbacksChange, providerAuths, onProviderAuthChange, onStartOAuth, onDetectLocalModels, onSaveSkillsConfig, skillsSaving, onSetupIntegration, onAddAgent,
  identityMd, soulMd, toolsMd, agentsMd, heartbeatMd, memoryMd,
  onIdentitySave, identitySaving,
  targetEnvironment, remoteSummary, gatewayPort, gatewayBind, gatewayAuthMode,
  heartbeatMode, sandboxMode, toolPolicy, toolsSaving, idleTimeoutMs, onSaveToolPolicy, onSaveAdvancedSettings, settingsBusy, maintenanceStatus,
  onRepair, onAudit, onUpgrade, onReconfigure, onUninstall, isConfigUpdating = false,
}: ChatShellProps) {
  const clientRef = useRef<GatewayChatClient | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const activeAgentIdRef = useRef("");
  const activeSessionKeyRef = useRef("");
  const activeThreadIdRef = useRef("");
  const activeRunIdRef = useRef("");
  const threadsRef = useRef<StoredChatThread[]>([]);
  const shouldAutoScrollRef = useRef(true);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior | null>("auto");
  const previousMessageCountRef = useRef(0);

  const [connectionLabel, setConnectionLabel] = useState("Connecting to gateway...");
  const [connectionState, setConnectionState] = useState<GatewayConnectState["status"]>("connecting");
  const [agents, setAgents] = useState<GatewayChatAgent[]>([]);
  const [liveSessions, setLiveSessions] = useState<GatewayChatSession[]>([]);
  const [threads, setThreads] = useState<StoredChatThread[]>([]);
  const [activeAgentId, setActiveAgentId] = useState("");
  const [activeSessionKey, setActiveSessionKey] = useState("");
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
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

  const openPanel = useCallback((view?: PanelView) => {
    if (view) setPanelView(view);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, []);

  const scopeKey = bootstrap ? buildChatScopeKey(bootstrap) : "";

  const activeThread = threads.find((thread) => thread.id === activeThreadId) || null;
  const activeThreadIsArchived = activeThread?.status === "archived";

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;

    const updatePosition = () => {
      shouldAutoScrollRef.current = isNearBottom(transcript);
    };

    updatePosition();
    transcript.addEventListener("scroll", updatePosition);
    return () => transcript.removeEventListener("scroll", updatePosition);
  }, [bootstrap]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      previousMessageCountRef.current = messages.length;
      pendingScrollBehaviorRef.current = null;
      return;
    }

    const shouldScroll =
      pendingScrollBehaviorRef.current !== null &&
      (shouldAutoScrollRef.current || messages.length > previousMessageCountRef.current);

    if (shouldScroll) {
      const scrollBehavior = pendingScrollBehaviorRef.current ?? undefined;
      if (typeof transcript.scrollTo === "function") {
        transcript.scrollTo({ top: transcript.scrollHeight, behavior: scrollBehavior });
      } else {
        transcript.scrollTop = transcript.scrollHeight;
      }
      shouldAutoScrollRef.current = true;
    }

    previousMessageCountRef.current = messages.length;
    pendingScrollBehaviorRef.current = null;
  }, [messages]);

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
    threadsRef.current = threads;
  }, [threads]);

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
        thread.sessionKey === params.sessionKey &&
        thread.status !== "archived" &&
        (!params.preferredThreadId || thread.id === params.preferredThreadId),
    );

    if (existing) {
      updateThreads((current) =>
        current.map((thread) =>
          thread.id !== existing.id
            ? thread
            : {
                ...thread,
                status: "live",
                sessionId: params.sessionId || params.session?.sessionId || thread.sessionId,
                title: deriveThreadTitle({ session: params.session, messages: thread.messages, fallback: thread.title }),
                preview: deriveThreadPreview({ session: params.session, messages: thread.messages, fallback: thread.preview }),
                updatedAt: params.session?.updatedAt || thread.updatedAt || Date.now(),
              },
        ),
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
    updateThreads((current) => [nextThread, ...current.filter((thread) => thread.id !== nextThread.id)]);
    return nextThread.id;
  }

  useEffect(() => {
    if (!bootstrap) return;

    const client = new GatewayChatClient(bootstrap);
    clientRef.current = client;

    client.onStateChange = (state) => {
      setConnectionState(state.status);

      if (state.status === "connected") {
        setConnectionLabel(`Connected to OpenClaw ${bootstrap.openClawVersion}`);
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

    client.onSessionsChanged = () => {
      if (activeAgentIdRef.current) {
        void refreshSessions(activeAgentIdRef.current, client, activeThreadIdRef.current || undefined);
      }
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
      const agentPayload = await client.listAgents();
      const nextAgents = agentPayload.agents || [];
      setAgents(nextAgents);

      const nextAgentId = agentPayload.defaultId || nextAgents[0]?.id || "";
      setActiveAgentId(nextAgentId);
      setMessages([]);
      setActiveRunId("");

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

  async function refreshSessions(agentId: string, client = clientRef.current, preferredThreadId?: string) {
    if (!client || !agentId) {
      setLiveSessions([]);
      setActiveSessionKey("");
      setMessages([]);
      return;
    }

    const sessionPayload = await client.listSessions(agentId || undefined);
    const nextSessions = sessionPayload.sessions || [];
    setLiveSessions(nextSessions);

    const desiredThreadId = preferredThreadId || loadStoredSelection(scopeKey, agentId) || "";
    const desiredThread = threadsRef.current.find((thread) => thread.id === desiredThreadId && thread.agentId === agentId);
    const desiredSessionKey = resolveSessionKeyForAgent({
      agentId,
      liveSessions: nextSessions,
      preferredSessionKey: desiredThread?.status !== "archived" ? desiredThread?.sessionKey : undefined,
    });
    const matchedSession = nextSessions.find((session) => session.key === desiredSessionKey);
    const nextThreadId = ensureLiveThread({
      agentId,
      sessionKey: desiredSessionKey,
      session: matchedSession,
      preferredThreadId: desiredThread?.status === "archived" ? undefined : desiredThread?.id,
      sessionId: matchedSession?.sessionId || desiredThread?.sessionId,
    });

    setActiveThreadId(nextThreadId);
    setActiveSessionKey(desiredSessionKey);

    const selectedThread =
      threadsRef.current.find((thread) => thread.id === nextThreadId) ||
      createThread({ agentId, sessionKey: desiredSessionKey, status: matchedSession ? "live" : "draft" });

    if (matchedSession) {
      await loadHistory(desiredSessionKey, nextThreadId, client);
      return;
    }

    pendingScrollBehaviorRef.current = "auto";
    setMessages(
      selectedThread.messages.map((message) => ({
        ...message,
      })),
    );
  }

  async function loadHistory(sessionKey: string, threadId: string, client = clientRef.current) {
    if (!client || !sessionKey) return;
    setLoadingHistory(true);
    try {
      const payload = await client.loadHistory(sessionKey);
      const nextMessages = toChatMessages(payload.messages);
      const latestMessage = nextMessages[nextMessages.length - 1];
      const shouldFinalizeActiveRun =
        sessionKey === activeSessionKeyRef.current &&
        !!activeRunIdRef.current &&
        latestMessage?.role === "assistant";

      pendingScrollBehaviorRef.current = "auto";
      setMessages(nextMessages);
      if (shouldFinalizeActiveRun) {
        setActiveRunId("");
        setSending(false);
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
        pendingScrollBehaviorRef.current = "auto";
        setMessages([]);
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

  function handleChatEvent(event: GatewayChatEventPayload) {
    if (!event.sessionKey || event.sessionKey !== activeSessionKeyRef.current) return;

    if (event.errorMessage) {
      pendingScrollBehaviorRef.current = "smooth";
      setMessages((current) => [
        ...current,
        { id: `error-${Date.now()}`, role: "system", text: event.errorMessage || "Gateway error.", error: true },
      ]);
      setActiveRunId("");
      setSending(false);
      return;
    }

    if (event.state === "final" || event.state === "aborted") {
      setMessages((current) =>
        current.flatMap((message) => {
          if (!message.runId || message.runId !== event.runId) {
            return [message];
          }

          const visibleText = message.role === "assistant"
            ? sanitizeAssistantTranscriptText(message.rawText || message.text)
            : message.text;

          if (message.role === "assistant" && !visibleText) {
            return [];
          }

          return [{ ...message, text: visibleText, pending: false }];
        }),
      );
      setActiveRunId("");
      setSending(false);
      void refreshSessions(activeAgentIdRef.current, clientRef.current || undefined, activeThreadIdRef.current || undefined);
    }
  }

  function handleAgentEvent(event: GatewayAgentEventPayload) {
    if (!event.runId || event.stream !== "assistant") return;
    const delta = typeof event.data.text === "string" ? event.data.text : "";
    if (!delta) return;

    setMessages((current) => {
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

      const rawText = delta;
      pendingScrollBehaviorRef.current = "smooth";
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
    setActiveAgentId(agentId);
    setLiveSessions([]);
    setActiveSessionKey("");
    setActiveThreadId("");
    setMessages([]);
    setActiveRunId("");
    await refreshSessions(agentId);
  }

  async function handleThreadSwitch(threadId: string) {
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) return;
    setActiveThreadId(threadId);
    setActiveSessionKey(thread.sessionKey);
    setShellError("");

    if (thread.status === "archived") {
      pendingScrollBehaviorRef.current = "auto";
      setMessages(
        thread.messages.map((message) => ({
          ...message,
        })),
      );
      return;
    }

    await loadHistory(thread.sessionKey, thread.id);
  }

  async function handleNewChat() {
    if (!clientRef.current || !activeAgentId || !activeSessionKey || connectionState !== "connected") return;

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
        if (thread.id !== activeThreadIdRef.current) {
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

    setActiveThreadId(freshThread.id);
    pendingScrollBehaviorRef.current = "auto";
    setMessages([]);
    setShellError("");
    setSending(true);

    try {
      const result = await clientRef.current.sendChat(activeSessionKey, "/new");
      setActiveRunId(result.runId);
      setMessages([{
        id: `assistant-${result.runId}`,
        role: "assistant",
        text: "",
        rawText: "",
        runId: result.runId,
        pending: true,
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSending(false);
      setShellError(`Failed to start a fresh chat: ${message}`);
    }
  }

  async function handleSend() {
    const text = composerValue.trim();
    if (!text || !clientRef.current || !activeSessionKey || connectionState !== "connected" || activeThreadIsArchived) {
      return;
    }

    if (text === "/stop") {
      setComposerValue("");
      await handleAbort();
      return;
    }

    if (sending) {
      return;
    }

    setComposerValue("");
    setSending(true);
    pendingScrollBehaviorRef.current = "smooth";
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", text, timestamp: Date.now() },
    ]);

    try {
      const result = await clientRef.current.sendChat(activeSessionKey, text);
      setActiveRunId(result.runId);
      pendingScrollBehaviorRef.current = "smooth";
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${result.runId}`,
          role: "assistant",
          text: "",
          rawText: "",
          runId: result.runId,
          pending: true,
        },
      ]);
    } catch (error) {
      setSending(false);
      pendingScrollBehaviorRef.current = "smooth";
      setMessages((current) => [
        ...current,
        { id: `error-${Date.now()}`, role: "system", text: String(error), error: true },
      ]);
    }
  }

  async function handleAbort() {
    if (!clientRef.current || !activeRunId || !activeSessionKey || connectionState !== "connected") return;
    const runId = activeRunId;

    setSending(false);
    setActiveRunId("");
    setMessages((current) =>
      current.map((message) => (message.runId === runId ? { ...message, pending: false } : message)),
    );

    try {
      await clientRef.current.abortChat(activeSessionKey, runId);
    } catch (error) {
      setShellError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleResetChat() {
    if (!clientRef.current || !activeSessionKey || connectionState !== "connected" || activeThreadIsArchived) return;
    pendingScrollBehaviorRef.current = "auto";
    setMessages([]);
    setSending(true);
    setShellError("");
    try {
      const result = await clientRef.current.sendChat(activeSessionKey, "/reset");
      setActiveRunId(result.runId);
      setMessages([{
        id: `assistant-${result.runId}`,
        role: "assistant",
        text: "",
        rawText: "",
        runId: result.runId,
        pending: true,
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSending(false);
      setShellError(`Failed to reset chat: ${message}`);
    }
  }

  const gatewayConnected = connectionState === "connected";
  const chatReady = !!bootstrap && !bootstrapping && gatewayConnected;
  const canCreateChat = chatReady && !!activeAgentId && !!activeSessionKey;
  const canSend =
    chatReady && !!activeAgentId && !!activeSessionKey && !!composerValue.trim() && !sending && !activeThreadIsArchived;
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

  const panelContextValue = {
    panelOpen,
    panelView,
    setPanelOpen,
    setPanelView,
    openPanel,
    closePanel,
  };

  if (panelOpen) {
    return (
      <ChatPanelContext.Provider value={panelContextValue}>
        <div className="chat-shell-fullpanel" data-theme={resolvedTheme}>
          <RightPanel
            agents={agents}
            activeAgentId={activeAgentId}
            onAgentSwitch={(agentId) => void handleAgentSwitch(agentId)}
            modelRef={agentModelRef}
            fallbackModels={agentFallbackModels}
            skills={agentSkills}
            onModelChange={onModelChange}
            onFallbacksChange={onFallbacksChange}
            providerAuths={providerAuths}
            onProviderAuthChange={onProviderAuthChange}
            onStartOAuth={onStartOAuth}
            onDetectLocalModels={onDetectLocalModels}
            activeSkills={agentSkills}
            serviceKeys={serviceKeys}
            onSaveSkillsConfig={onSaveSkillsConfig}
            skillsSaving={skillsSaving}
            onSetupIntegration={onSetupIntegration}
            onAddAgent={onAddAgent}
            identityMd={identityMd}
            soulMd={soulMd}
            toolsMd={toolsMd}
            agentsMd={agentsMd}
            heartbeatMd={heartbeatMd}
            memoryMd={memoryMd}
            onIdentitySave={onIdentitySave}
            identitySaving={identitySaving}
            targetEnvironment={targetEnvironment}
            remoteSummary={remoteSummary}
            gatewayPort={gatewayPort}
            gatewayBind={gatewayBind}
            gatewayAuthMode={gatewayAuthMode}
            heartbeatMode={heartbeatMode}
            sandboxMode={sandboxMode}
            toolPolicy={toolPolicy}
            toolsSaving={toolsSaving}
            idleTimeoutMs={idleTimeoutMs}
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
          canCreateChat={canCreateChat}
          onNewChat={() => void handleNewChat()}
          liveThreads={liveThreads}
          archivedThreads={archivedThreads}
          activeThreadId={activeThreadId}
          onThreadSwitch={(threadId) => void handleThreadSwitch(threadId)}
          themePreference={themePreference}
          onThemeChange={setThemePreference}
          onOpenConfigure={onOpenConfigure}
          onOpenPanel={(view) => openPanel(view as PanelView)}
          connectionLabel={connectionLabel}
        />

        <section className="chat-main-panel">
          <ChatHeader
            agents={agents}
            activeAgentId={activeAgentId}
            activeAgentName={activeAgentName}
            activeSessionKey={activeSessionKey}
            activeThreadIsArchived={activeThreadIsArchived}
            gatewayConnected={gatewayConnected}
            chatReady={chatReady}
            showEmptyAgentState={showEmptyAgentState}
            onAgentSwitch={(agentId) => void handleAgentSwitch(agentId)}
            onResetChat={() => void handleResetChat()}
            onRetryConnection={onRetryConnection}
            modelRef={agentModelRef}
            fallbackCount={agentFallbackCount}
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
                showConnectingState={showConnectingState}
                isConfigUpdating={isConfigUpdating && connectionState !== "connected"}
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
