import { memo, useEffect, useRef, useState } from "react";
import type { GatewayChatBootstrap } from "../../types";
import {
  extractMessageText,
  GatewayChatClient,
  type GatewayAgentEventPayload,
  type GatewayChatAgent,
  type GatewayChatEventPayload,
  type GatewayChatSession,
} from "../../lib/gatewayChat";

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

function toChatMessages(rawMessages: unknown[] | undefined): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages
    .map((item, index) => {
      if (typeof item !== "object" || item === null) return null;
      const message = item as Record<string, unknown>;
      const role = message.role === "assistant" || message.role === "system" ? message.role : "user";
      const text = extractMessageText(message);
      if (!text) return null;
      return {
        id: `${String(message.timestamp || index)}-${role}`,
        role,
        text,
        timestamp: typeof message.timestamp === "number" ? message.timestamp : undefined,
      } satisfies ChatMessage;
    })
    .filter((item): item is ChatMessage => item !== null);
}

function formatSessionTitle(session: GatewayChatSession) {
  return session.displayName || session.derivedTitle || session.lastMessagePreview || session.key;
}

function ChatShell({ bootstrap, bootstrapping, bootstrapError, onRetryConnection, onOpenConfigure }: ChatShellProps) {
  const clientRef = useRef<GatewayChatClient | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeAgentIdRef = useRef("");
  const activeSessionKeyRef = useRef("");

  const [connectionLabel, setConnectionLabel] = useState("Connecting to gateway...");
  const [agents, setAgents] = useState<GatewayChatAgent[]>([]);
  const [sessions, setSessions] = useState<GatewayChatSession[]>([]);
  const [activeAgentId, setActiveAgentId] = useState("");
  const [activeSessionKey, setActiveSessionKey] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState("");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
  }, [activeAgentId]);

  useEffect(() => {
    activeSessionKeyRef.current = activeSessionKey;
  }, [activeSessionKey]);

  useEffect(() => {
    if (!bootstrap) return;

    const client = new GatewayChatClient(bootstrap);
    clientRef.current = client;

    client.onStateChange = (state) => {
      if (state.status === "connected") {
        setConnectionLabel(`Connected to OpenClaw ${bootstrap.openClawVersion}`);
      } else if (state.status === "reconnecting") {
        setConnectionLabel("Reconnecting to gateway...");
      } else if (state.status === "error") {
        setConnectionLabel(state.error || "Gateway connection failed.");
      } else {
        setConnectionLabel("Connecting to gateway...");
      }
    };

    client.onSeqGap = () => {
      if (activeSessionKeyRef.current) {
        void loadHistory(activeSessionKeyRef.current, client);
      }
    };

    client.onChatEvent = (event) => {
      handleChatEvent(event);
    };

    client.onAgentEvent = (event) => {
      handleAgentEvent(event);
    };

    void (async () => {
      try {
        await client.connect();
        await bootstrapShell(client);
      } catch (error) {
        setConnectionLabel(String(error));
      }
    })();

    return () => {
      client.disconnect();
      if (clientRef.current === client) {
        clientRef.current = null;
      }
    };
  }, [bootstrap]);

  async function bootstrapShell(client: GatewayChatClient) {
    const agentPayload = await client.listAgents();
    const nextAgents = agentPayload.agents || [];
    setAgents(nextAgents);
    const nextAgentId = agentPayload.defaultId || nextAgents[0]?.id || "";
    setActiveAgentId(nextAgentId);
    await refreshSessions(nextAgentId, client);
  }

  async function refreshSessions(agentId: string, client = clientRef.current, preferredKey?: string) {
    if (!client) return;
    const sessionPayload = await client.listSessions(agentId || undefined);
    let nextSessions = sessionPayload.sessions || [];
    let nextSessionKey = preferredKey || activeSessionKey;

    if (!nextSessionKey || !nextSessions.some((session) => session.key === nextSessionKey)) {
      nextSessionKey = nextSessions[0]?.key || "";
    }

    if (!nextSessionKey) {
      const created = await client.createSession(agentId || undefined);
      nextSessionKey = created.key;
      const refreshed = await client.listSessions(agentId || undefined);
      nextSessions = refreshed.sessions || [];
    }

    setSessions(nextSessions);
    setActiveSessionKey(nextSessionKey);
    await loadHistory(nextSessionKey, client);
  }

  async function loadHistory(sessionKey: string, client = clientRef.current) {
    if (!client || !sessionKey) return;
    setLoadingHistory(true);
    try {
      const payload = await client.loadHistory(sessionKey);
      setMessages(toChatMessages(payload.messages));
    } finally {
      setLoadingHistory(false);
    }
  }

  function handleChatEvent(event: GatewayChatEventPayload) {
    if (!event.sessionKey || event.sessionKey !== activeSessionKeyRef.current) return;

    if (event.errorMessage) {
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
      void refreshSessions(activeAgentIdRef.current, clientRef.current || undefined, activeSessionKeyRef.current);
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
          index === existingIndex ? { ...message, text: `${message.text}${delta}`, pending: true } : message,
        );
      }
      return [
        ...current,
        { id: `assistant-${event.runId}`, role: "assistant", text: delta, runId: event.runId, pending: true },
      ];
    });
  }

  async function handleAgentSwitch(agentId: string) {
    if (!agentId || agentId === activeAgentId) return;
    setActiveAgentId(agentId);
    setSessions([]);
    setMessages([]);
    setActiveRunId("");
    await refreshSessions(agentId);
  }

  async function handleSessionSwitch(sessionKey: string) {
    setActiveSessionKey(sessionKey);
    await loadHistory(sessionKey);
  }

  async function handleNewChat() {
    if (!clientRef.current) return;
    const created = await clientRef.current.createSession(activeAgentId || undefined);
    await refreshSessions(activeAgentId, clientRef.current, created.key);
  }

  async function handleSend() {
    const text = composerValue.trim();
    if (!text || !clientRef.current || !activeSessionKey || sending) return;

    setComposerValue("");
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", text, timestamp: Date.now() },
    ]);

    try {
      const result = await clientRef.current.sendChat(activeSessionKey, text);
      setActiveRunId(result.runId);
      setMessages((current) => [
        ...current,
        { id: `assistant-${result.runId}`, role: "assistant", text: "", runId: result.runId, pending: true },
      ]);
    } catch (error) {
      setSending(false);
      setMessages((current) => [
        ...current,
        { id: `error-${Date.now()}`, role: "system", text: String(error), error: true },
      ]);
    }
  }

  async function handleAbort() {
    if (!clientRef.current || !activeRunId || !activeSessionKey) return;
    await clientRef.current.abortChat(activeSessionKey, activeRunId);
    setSending(false);
    setActiveRunId("");
    setMessages((current) =>
      current.map((message) => (message.runId === activeRunId ? { ...message, pending: false } : message)),
    );
  }

  async function handleResetChat() {
    if (!clientRef.current || !activeSessionKey) return;
    await clientRef.current.resetSession(activeSessionKey);
    await loadHistory(activeSessionKey);
  }

  const chatReady = !!bootstrap && !bootstrapping;

  return (
    <div className="chat-shell">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-brand">
          <p className="chat-sidebar-kicker">Clawnetes OS</p>
          <h1>Agent Workspace</h1>
          <p>{connectionLabel}</p>
        </div>

        <div className="chat-sidebar-section">
          <div className="chat-sidebar-section-header">
            <span>Agents</span>
          </div>
          <div className="chat-agent-list">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`chat-list-item ${activeAgentId === agent.id ? "active" : ""}`}
                onClick={() => void handleAgentSwitch(agent.id)}
              >
                <strong>{agent.name || agent.id}</strong>
                <small>{agent.id}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="chat-sidebar-section">
          <div className="chat-sidebar-section-header">
            <span>Sessions</span>
            <button className="secondary" disabled={!chatReady} onClick={() => void handleNewChat()}>New Chat</button>
          </div>
          <div className="chat-session-list">
            {sessions.map((session) => (
              <button
                key={session.key}
                className={`chat-list-item ${activeSessionKey === session.key ? "active" : ""}`}
                onClick={() => void handleSessionSwitch(session.key)}
              >
                <strong>{formatSessionTitle(session)}</strong>
                <small>{session.key}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="chat-sidebar-actions">
          <button className="secondary" onClick={onOpenConfigure}>Configure</button>
        </div>
      </aside>

      <section className="chat-main-panel">
        <header className="chat-main-header">
          <div>
            <p className="chat-sidebar-kicker">Active Agent</p>
            <h2>{agents.find((agent) => agent.id === activeAgentId)?.name || activeAgentId || "No agent selected"}</h2>
          </div>
          <div className="chat-main-actions">
            <button className="secondary" disabled={!activeSessionKey} onClick={() => void handleResetChat()}>Reset Chat</button>
            <button className="secondary" onClick={onRetryConnection}>Reconnect</button>
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
              {loadingHistory ? (
                <div className="chat-state-card">
                  <h3>Loading session</h3>
                  <p>Fetching the latest transcript from OpenClaw.</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="chat-state-card">
                  <h3>New conversation</h3>
                  <p>Start typing to drive the active OpenClaw agent.</p>
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    key={message.id}
                    className={`chat-bubble ${message.role} ${message.error ? "error" : ""}`}
                  >
                    <span className="chat-bubble-role">{message.role}</span>
                    <p>{message.text || (message.pending ? "Thinking..." : "")}</p>
                  </article>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-composer">
              <textarea
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                placeholder="Ask OpenClaw to do real work..."
                rows={4}
              />
              <div className="chat-composer-actions">
                <span>{bootstrapError || connectionLabel}</span>
                <div>
                  <button className="secondary" disabled={!activeRunId} onClick={() => void handleAbort()}>Abort</button>
                  <button className="primary" disabled={!composerValue.trim() || sending} onClick={() => void handleSend()}>
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default memo(ChatShell);
