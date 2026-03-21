import { memo, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { GatewayChatBootstrap } from "../../types";
import {
  extractMessageText,
  GatewayChatClient,
  type GatewayAgentEventPayload,
  type GatewayChatAgent,
  type GatewayConnectState,
  type GatewayChatEventPayload,
  type GatewayChatSession,
} from "../../lib/gatewayChat";
import { generateUUID } from "../../lib/gatewayUuid";
import {
  buildChatScopeKey,
  loadStoredSelection,
  loadStoredThreads,
  loadThemePreference,
  resolveThemePreference,
  saveStoredSelection,
  saveStoredThreads,
  saveThemePreference,
  type ChatResolvedTheme,
  type ChatThemePreference,
  type StoredChatMessage,
  type StoredChatThread,
} from "../../lib/chatShellStorage";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  runId?: string;
  pending?: boolean;
  error?: boolean;
  timestamp?: number;
};

interface ChatShellProps {
  bootstrap: GatewayChatBootstrap | null;
  bootstrapping: boolean;
  bootstrapError: string;
  onRetryConnection: () => void;
  onOpenConfigure: () => void;
}

function isToolMessage(message: Record<string, unknown>): boolean {
  if (message.type === "tool_use" || message.type === "tool_result") return true;

  if (Array.isArray(message.content)) {
    const hasToolPart = (message.content as Record<string, unknown>[]).some(
      (part) => typeof part === "object" && part !== null && (part.type === "tool_use" || part.type === "tool_result"),
    );
    if (hasToolPart) return true;
  }

  if (message.role === "user") {
    const text = extractMessageText(message);
    if (text.startsWith("{") && (text.includes('"tool":') || text.includes('"status":'))) return true;
  }

  return false;
}

function normalizeTranscriptText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function isBootstrapNoiseText(text: string) {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return false;

  return (
    /A new session was started via \/new or \/reset\./i.test(normalized) ||
    /Run your Session Startup sequence/i.test(normalized) ||
    /^Current time:/i.test(normalized) ||
    /^#\s*(SOUL|USER|MEMORY)\.md\b/i.test(text.trim()) ||
    (/\"status\"\s*:\s*\"error\"/i.test(text) &&
      /\"tool\"\s*:\s*\"read\"/i.test(text) &&
      /ENOENT: no such file or directory/i.test(text)) ||
    (/ENOENT: no such file or directory/i.test(text) && /(workspace\/memory|MEMORY\.md)/i.test(text))
  );
}

function shouldHideTranscriptMessage(message: Record<string, unknown>) {
  if (isToolMessage(message)) return true;

  const role = message.role === "assistant" || message.role === "system" ? message.role : "user";
  const text = extractMessageText(message);

  if (!text || role === "system") return true;
  if (isBootstrapNoiseText(text)) return true;

  return false;
}

function toChatMessages(rawMessages: unknown[] | undefined): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];
  const messages: ChatMessage[] = [];
  rawMessages.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return;
    const message = item as Record<string, unknown>;

    if (shouldHideTranscriptMessage(message)) return;

    const role = message.role === "assistant" || message.role === "system" ? message.role : "user";
    const text = extractMessageText(message);
    messages.push({
      id: `${String(message.timestamp || index)}-${role}`,
      role,
      text,
      timestamp: typeof message.timestamp === "number" ? message.timestamp : undefined,
    });
  });
  return messages;
}

function toStoredMessages(messages: ChatMessage[]): StoredChatMessage[] {
  return messages
    .filter((message) => !message.pending)
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      timestamp: message.timestamp,
      error: message.error,
    }));
}

function clipLabel(value: string, max = 42) {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function formatSessionTitle(session: GatewayChatSession) {
  return session.displayName || session.derivedTitle || session.lastMessagePreview || session.key;
}

function deriveThreadTitle(params: {
  session?: GatewayChatSession;
  messages?: StoredChatMessage[];
  fallback?: string;
}) {
  const userPrompt = params.messages?.find((message) => message.role === "user" && message.text.trim());
  if (userPrompt) {
    return clipLabel(userPrompt.text.replace(/\s+/g, " "));
  }
  if (params.session) {
    return clipLabel(formatSessionTitle(params.session));
  }
  return clipLabel(params.fallback || "New chat") || "New chat";
}

function deriveThreadPreview(params: {
  session?: GatewayChatSession;
  messages?: StoredChatMessage[];
  fallback?: string;
}) {
  const lastMessage = [...(params.messages || [])].reverse().find((message) => message.text.trim());
  if (lastMessage) {
    return clipLabel(lastMessage.text.replace(/\s+/g, " "), 80);
  }
  if (params.session?.lastMessagePreview) {
    return clipLabel(params.session.lastMessagePreview.replace(/\s+/g, " "), 80);
  }
  return clipLabel(params.fallback || "Fresh conversation", 80) || "Fresh conversation";
}

function createThread(params: {
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  status: StoredChatThread["status"];
  session?: GatewayChatSession;
  title?: string;
  preview?: string;
  messages?: StoredChatMessage[];
}) {
  const messages = params.messages || [];
  return {
    id: generateUUID(),
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    title: deriveThreadTitle({ session: params.session, messages, fallback: params.title }),
    preview: deriveThreadPreview({ session: params.session, messages, fallback: params.preview }),
    updatedAt: Date.now(),
    status: params.status,
    messages,
  } satisfies StoredChatThread;
}

function readPrefersDark() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
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

function ChatIcon({ name }: { name: string }) {
  switch (name) {
    case "plus":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M8 3v10" />
          <path d="M3 8h10" />
        </svg>
      );
    case "sliders":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 4h10" />
          <path d="M5 8h8" />
          <path d="M3 12h10" />
          <circle cx="6" cy="4" r="1.25" />
          <circle cx="10" cy="8" r="1.25" />
          <circle cx="8" cy="12" r="1.25" />
        </svg>
      );
    case "reset":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2" />
          <path d="M3.5 4.5v3h3" />
        </svg>
      );
    case "reconnect":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M13 5.5V3h-2.5" />
          <path d="M3 10.5V13h2.5" />
          <path d="M12.2 7A4.5 4.5 0 0 0 4 5.4" />
          <path d="M3.8 9A4.5 4.5 0 0 0 12 10.6" />
        </svg>
      );
    case "sun":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1.75v1.5" />
          <path d="M8 12.75v1.5" />
          <path d="M1.75 8h1.5" />
          <path d="M12.75 8h1.5" />
          <path d="M3.35 3.35l1.05 1.05" />
          <path d="M11.6 11.6l1.05 1.05" />
          <path d="M12.65 3.35L11.6 4.4" />
          <path d="M4.4 11.6l-1.05 1.05" />
        </svg>
      );
    case "moon":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M10.8 2.2A5.8 5.8 0 1 0 13.8 11 5.2 5.2 0 0 1 10.8 2.2Z" />
        </svg>
      );
    case "system":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <rect x="2.5" y="3" width="11" height="8" rx="1.5" />
          <path d="M6 13h4" />
          <path d="M8 11v2" />
        </svg>
      );
    case "spark":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5Z" />
        </svg>
      );
    case "note":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 3.5h10" />
          <path d="M3 7.5h10" />
          <path d="M3 11.5h7" />
        </svg>
      );
    case "plan":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 4.5h10" />
          <path d="M3 8h10" />
          <path d="M3 11.5h6.5" />
          <circle cx="11.75" cy="11.5" r="1.25" />
        </svg>
      );
    case "chat":
    default:
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v4A1.5 1.5 0 0 1 11.5 10h-4l-2.75 2v-2H4.5A1.5 1.5 0 0 1 3 8.5Z" />
        </svg>
      );
  }
}

function ChatActionButton({
  icon,
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
}) {
  return (
    <button className={`chat-action-button ${className || ""}`.trim()} {...props}>
      <span className="chat-button-icon">{icon}</span>
      <span className="chat-button-label">{children || label}</span>
    </button>
  );
}

function ChatShell({ bootstrap, bootstrapping, bootstrapError, onRetryConnection, onOpenConfigure }: ChatShellProps) {
  const clientRef = useRef<GatewayChatClient | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const activeAgentIdRef = useRef("");
  const activeSessionKeyRef = useRef("");
  const activeThreadIdRef = useRef("");
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
  const [themePreference, setThemePreference] = useState<ChatThemePreference>(() => loadThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ChatResolvedTheme>(() =>
    resolveThemePreference(loadThemePreference(), readPrefersDark()),
  );

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

    const desiredThreadId = preferredThreadId || loadStoredSelection(scopeKey, agentId) || activeThreadIdRef.current;
    const desiredThread = threadsRef.current.find((thread) => thread.id === desiredThreadId && thread.agentId === agentId);
    const desiredSessionKey = desiredThread?.sessionKey || activeSessionKeyRef.current || nextSessions[0]?.key || "main";
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

    if (matchedSession || desiredSessionKey === "main") {
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
      pendingScrollBehaviorRef.current = "auto";
      setMessages(nextMessages);
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
        current.map((message) =>
          message.runId && message.runId === event.runId ? { ...message, pending: false } : message,
        ),
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
        return current.map((message, index) =>
          index === existingIndex
            ? { ...message, text: mergeAssistantStreamText(message.text, delta), pending: true }
            : message,
        );
      }
      pendingScrollBehaviorRef.current = "smooth";
      return [
        ...current,
        { id: `assistant-${event.runId}`, role: "assistant", text: delta, runId: event.runId, pending: true },
      ];
    });
  }

  async function handleAgentSwitch(agentId: string) {
    if (!agentId || agentId === activeAgentId) return;
    setActiveAgentId(agentId);
    setLiveSessions([]);
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
      setMessages([{ id: `assistant-${result.runId}`, role: "assistant", text: "", runId: result.runId, pending: true }]);
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
        { id: `assistant-${result.runId}`, role: "assistant", text: "", runId: result.runId, pending: true },
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
      setMessages([{ id: `assistant-${result.runId}`, role: "assistant", text: "", runId: result.runId, pending: true }]);
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
    connectionState === "connecting" ||
    connectionState === "challenged" ||
    connectionState === "authenticating" ||
    connectionState === "reconnecting";

  const agentThreads = threads
    .filter((thread) => thread.agentId === activeAgentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const liveThreads = agentThreads.filter((thread) => thread.status !== "archived");
  const archivedThreads = agentThreads.filter((thread) => thread.status === "archived");

  return (
    <div className="chat-shell" data-theme={resolvedTheme}>
      <aside className="chat-sidebar">
        <div className="chat-sidebar-top">
          <div className="chat-sidebar-brand">
            <p className="chat-sidebar-kicker">Clawnetes</p>
            <h1>Agent Workspace</h1>
            <span className="chat-sidebar-subtle">OpenClaw desktop shell</span>
          </div>

          <button
            className="chat-primary-button"
            data-testid="chat-new-session"
            disabled={!canCreateChat}
            onClick={() => void handleNewChat()}
          >
            <span className="chat-button-icon"><ChatIcon name="plus" /></span>
            <span className="chat-button-label">New chat</span>
          </button>
        </div>

        <div className="chat-sidebar-section">
          <div className="chat-sidebar-section-header">
            <span>Live</span>
          </div>
          <div className="chat-session-list">
            {liveThreads.length === 0 ? (
              <div className="chat-list-empty">No active chats yet.</div>
            ) : (
              liveThreads.map((thread) => (
                <button
                  key={thread.id}
                  className={`chat-list-item ${activeThreadId === thread.id ? "active" : ""}`}
                  onClick={() => void handleThreadSwitch(thread.id)}
                  data-testid={`chat-thread-${thread.id}`}
                  type="button"
                >
                  <span className="chat-list-item-icon"><ChatIcon name="chat" /></span>
                  <strong title={thread.title}>{thread.title}</strong>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="chat-sidebar-section">
          <div className="chat-sidebar-section-header">
            <span>Recent</span>
          </div>
          <div className="chat-session-list">
            {archivedThreads.length === 0 ? (
              <div className="chat-list-empty">Past chats appear here after `/new`.</div>
            ) : (
              archivedThreads.map((thread) => (
                <button
                  key={thread.id}
                  className={`chat-list-item archived ${activeThreadId === thread.id ? "active" : ""}`}
                  onClick={() => void handleThreadSwitch(thread.id)}
                  type="button"
                >
                  <span className="chat-list-item-icon"><ChatIcon name="note" /></span>
                  <strong title={thread.title}>{thread.title}</strong>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="chat-sidebar-actions">
          <div className="chat-theme-toggle" role="group" aria-label="Theme">
            {(["light", "dark", "system"] as ChatThemePreference[]).map((theme) => (
              <button
                key={theme}
                className={themePreference === theme ? "active" : ""}
                onClick={() => setThemePreference(theme)}
                type="button"
              >
                <span className="chat-button-icon">
                  <ChatIcon name={theme === "light" ? "sun" : theme === "dark" ? "moon" : "system"} />
                </span>
                <span className="chat-button-label">{theme}</span>
              </button>
            ))}
          </div>
          <ChatActionButton
            className="secondary"
            data-testid="chat-configure"
            icon={<ChatIcon name="sliders" />}
            label="Configure"
            onClick={onOpenConfigure}
            type="button"
          />
          <div className="chat-sidebar-status">{connectionLabel}</div>
        </div>
      </aside>

      <section className="chat-main-panel">
        <header className="chat-main-header">
          <div className="chat-header-agent">
            <p className="chat-sidebar-kicker">Active Agent</p>
            {agents.length > 1 ? (
              <select
                className="chat-agent-dropdown"
                data-testid="chat-active-agent"
                value={activeAgentId}
                onChange={(e) => void handleAgentSwitch(e.target.value)}
                disabled={!gatewayConnected}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
                ))}
              </select>
            ) : (
              <h2 data-testid="chat-active-agent">
                {showEmptyAgentState ? "No agents available" : activeAgentName || "Connecting to gateway..."}
              </h2>
            )}
            <span className="chat-header-thread-meta">
              {activeThreadIsArchived ? "Archived transcript" : `Session ${activeSessionKey || "main"}`}
            </span>
          </div>
          <div className="chat-main-actions">
            <ChatActionButton
              className="secondary"
              data-testid="chat-reset"
              disabled={!chatReady || !activeSessionKey || activeThreadIsArchived}
              icon={<ChatIcon name="reset" />}
              label="Reset"
              onClick={() => void handleResetChat()}
              type="button"
            />
            <ChatActionButton
              className="secondary"
              data-testid="chat-reconnect"
              icon={<ChatIcon name="reconnect" />}
              label="Reconnect"
              onClick={onRetryConnection}
              type="button"
            />
          </div>
        </header>

        {!bootstrap && (
          <div className="chat-state-card">
            <h3>Starting the gateway workspace</h3>
            <p>{bootstrapping ? "Preparing the OpenClaw gateway connection..." : bootstrapError || "No gateway connection available."}</p>
            {!bootstrapping && <button onClick={onRetryConnection}>Retry</button>}
          </div>
        )}

        {bootstrap && (
          <>
            <div className="chat-transcript">
              <div ref={transcriptRef} className="chat-transcript-scroll">
              {showConnectingState ? (
                <div className="chat-state-card" data-testid="chat-connecting-state">
                  <h3>Connecting to OpenClaw</h3>
                  <p>{connectionLabel}</p>
                </div>
              ) : shellError ? (
                <div className="chat-state-card error" data-testid="chat-error-state">
                  <h3>Gateway connection failed</h3>
                  <p>{shellError}</p>
                </div>
              ) : showEmptyAgentState ? (
                <div className="chat-state-card" data-testid="chat-empty-agent-state">
                  <h3>No agents available</h3>
                  <p>The OpenClaw gateway is connected, but it did not return any configured agents.</p>
                </div>
              ) : loadingHistory ? (
                <div className="chat-state-card">
                  <h3>Loading session</h3>
                  <p>Fetching the latest transcript from OpenClaw.</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="chat-empty-stage">
                  <div className="chat-empty-stage-badge">Workspace</div>
                  <h3>{activeThreadIsArchived ? activeThread?.title || "Archived chat" : "Let’s build"}</h3>
                  <p>
                    {activeThreadIsArchived
                      ? "This transcript is archived locally. Switch to a live chat or start a new one to keep sending."
                      : `${activeAgentName || "Your agent"} is ready on ${activeSessionKey || "main"}.`}
                  </p>
                  {!activeThreadIsArchived && (
                    <div className="chat-suggestion-grid">
                      <ChatActionButton
                        icon={<ChatIcon name="spark" />}
                        label="Build a release checklist"
                        onClick={() => setComposerValue("Build a release checklist for this repo.")}
                        type="button"
                      />
                      <ChatActionButton
                        icon={<ChatIcon name="note" />}
                        label="Summarize this workspace"
                        onClick={() => setComposerValue("Summarize the current OpenClaw chat architecture.")}
                        type="button"
                      />
                      <ChatActionButton
                        icon={<ChatIcon name="plan" />}
                        label="Create a plan"
                        onClick={() => setComposerValue("Draft an implementation plan for the next bugfix.")}
                        type="button"
                      />
                    </div>
                  )}
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    key={message.id}
                    className={`chat-bubble ${message.role} ${message.error ? "error" : ""}`}
                  >
                    <span className="chat-bubble-role">
                      {message.role === "user" ? "You" : message.role === "assistant" ? activeAgentName : "System"}
                    </span>
                    <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                      {message.text || (message.pending ? "Thinking..." : "")}
                    </p>
                  </article>
                ))
              )}
              </div>
            </div>

            <div className="chat-composer">
              <div className="chat-composer-input-wrap">
                <textarea
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={
                    activeThreadIsArchived
                      ? "Archived chats are read-only"
                      : `Message ${activeAgentName || "agent"} (Enter to send)`
                  }
                  rows={1}
                  data-testid="chat-composer"
                  disabled={!chatReady || !activeAgentId || activeThreadIsArchived}
                />
                {sending ? (
                  <button
                    className="chat-composer-icon-btn stop"
                    onClick={() => void handleAbort()}
                    disabled={!activeRunId || !chatReady}
                    aria-label="Stop"
                    data-testid="chat-stop"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
                  </button>
                ) : (
                  <button
                    className="chat-composer-icon-btn send"
                    data-testid="chat-send"
                    disabled={!canSend}
                    onClick={() => void handleSend()}
                    aria-label="Send"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="12" x2="8" y2="4" /><polyline points="4,7 8,3 12,7" /></svg>
                  </button>
                )}
              </div>
              <span className="chat-composer-status">
                {sending ? "Agent is thinking..." : activeThreadIsArchived ? "Read-only archived transcript" : "Enter sends, Shift+Enter adds a new line"}
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default memo(ChatShell);
