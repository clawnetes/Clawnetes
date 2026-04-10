import type { GatewayChatBootstrap } from "../types";
import type {
  GatewayAgentEventPayload,
  GatewayChatAgent,
  GatewayChatEventPayload,
  GatewayChatHistoryPayload,
  GatewayChatSession,
  GatewayConnectState,
  GatewaySessionsChangedPayload,
} from "./gatewayChat";

type HermesRunStreamEvent =
  | { event: "message.delta"; run_id: string; delta?: string }
  | { event: "run.completed"; run_id: string; output?: string; usage?: Record<string, unknown> }
  | { event: "run.failed"; run_id: string; error?: string }
  | { event: string; run_id?: string; [key: string]: unknown };

type HermesSessionState = {
  key: string;
  sessionId: string;
  displayName: string;
  derivedTitle: string;
  updatedAt: number;
  messages: Array<Record<string, unknown>>;
};

type HermesModelsResponse = {
  data?: Array<{ id?: string; owned_by?: string }>;
};

function parseJsonSafely<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractSessionTitle(messages: Array<Record<string, unknown>>) {
  const firstUser = messages.find((message) => message.role === "user");
  const text = typeof firstUser?.text === "string" ? firstUser.text.trim() : "";
  return text ? text.slice(0, 48) : "Hermes Session";
}

export class HermesChatTransport {
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly sessions = new Map<string, HermesSessionState>();
  private readonly activeRuns = new Map<string, { controller: AbortController; sessionKey: string; userMessage: string }>();
  private static readonly AGENT_ID = "hermes-agent";
  private static readonly AGENT_NAME = "hermes-agent";

  onStateChange?: (state: GatewayConnectState) => void;
  onHealth?: (ok: boolean) => void;
  onChatEvent?: (payload: GatewayChatEventPayload) => void;
  onAgentEvent?: (payload: GatewayAgentEventPayload) => void;
  onSessionsChanged?: (payload: GatewaySessionsChangedPayload) => void;
  onSeqGap?: () => void;
  onReady?: (payload?: unknown) => void;

  constructor(private readonly bootstrap: GatewayChatBootstrap) {
    this.apiBaseUrl = (bootstrap.apiBaseUrl || "").replace(/\/+$/, "");
    this.apiKey = bootstrap.apiKey || bootstrap.authToken || "";
    this.ensureSession(HermesChatTransport.AGENT_ID);
  }

  async connect() {
    this.emitState("connecting");
    await this.fetchJson("/health", { bypassV1Prefix: true });
    this.onHealth?.(true);
    this.emitState("connected");
    this.onReady?.({ platform: "hermes" });
  }

  disconnect() {
    for (const run of this.activeRuns.values()) {
      run.controller.abort();
    }
    this.activeRuns.clear();
    this.emitState("disconnected");
  }

  async listAgents(): Promise<{ defaultId?: string; agents: GatewayChatAgent[] }> {
    try {
      const models = await this.fetchJson<HermesModelsResponse>("/models");
      const agents = (models.data || [])
        .map((model) => model.id?.trim())
        .filter((id): id is string => Boolean(id))
        .map((id) => ({ id, name: id }));

      if (agents.length > 0) {
        return {
          defaultId: agents[0].id,
          agents,
        };
      }
    } catch {
      // Older Hermes builds may not expose /models yet; keep a stable fallback.
    }

    return {
      defaultId: HermesChatTransport.AGENT_ID,
      agents: [{ id: HermesChatTransport.AGENT_ID, name: HermesChatTransport.AGENT_NAME }],
    };
  }

  async listSessions(): Promise<{ sessions: GatewayChatSession[] }> {
    return {
      sessions: [...this.sessions.values()].map((session) => ({
        key: session.key,
        sessionId: session.sessionId,
        displayName: session.displayName,
        derivedTitle: session.derivedTitle,
        updatedAt: session.updatedAt,
        lastMessagePreview: this.extractLastPreview(session.messages),
      })),
    };
  }

  async loadHistory(sessionKey: string): Promise<GatewayChatHistoryPayload> {
    const session = this.ensureSession(sessionKey);
    return {
      sessionKey,
      sessionId: session.sessionId,
      messages: session.messages.map((message) => ({ ...message })),
    };
  }

  async sendChat(sessionKey: string, message: string): Promise<{ runId: string }> {
    const normalizedMessage = message.trim();
    if (normalizedMessage === "/new" || normalizedMessage === "/reset") {
      return this.handleLocalReset(sessionKey, normalizedMessage);
    }

    const session = this.ensureSession(sessionKey);
    const response = await this.fetchJson<{ run_id: string }>("/runs", {
      method: "POST",
      body: JSON.stringify({
        input: normalizedMessage,
        conversation_history: session.messages.map((entry) => ({
          role: entry.role,
          content: typeof entry.text === "string" ? entry.text : "",
        })),
        session_id: sessionKey,
      }),
    });

    const runId = response.run_id;
    const controller = new AbortController();
    this.activeRuns.set(runId, { controller, sessionKey, userMessage: normalizedMessage });
    void this.consumeRunEvents(runId, controller, sessionKey, normalizedMessage);
    return { runId };
  }

  async abortChat(_sessionKey: string, runId: string) {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return {};
    }
    activeRun.controller.abort();
    this.activeRuns.delete(runId);
    this.onChatEvent?.({
      runId,
      sessionKey: activeRun.sessionKey,
      state: "aborted",
    });
    this.onSessionsChanged?.({
      sessionKey: activeRun.sessionKey,
      status: "aborted",
      abortedLastRun: true,
      updatedAt: Date.now(),
    });
    return {};
  }

  async resetSession(sessionKey: string) {
    const session = this.ensureSession(sessionKey);
    session.messages = [];
    session.updatedAt = Date.now();
    session.derivedTitle = "Hermes Session";
    this.onSessionsChanged?.({
      sessionKey,
      updatedAt: session.updatedAt,
      session: {
        key: session.key,
        sessionId: session.sessionId,
        displayName: session.displayName,
        derivedTitle: session.derivedTitle,
        updatedAt: session.updatedAt,
      },
    });
    return {};
  }

  private ensureSession(sessionKey: string) {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      return existing;
    }

    const created: HermesSessionState = {
      key: sessionKey,
      sessionId: sessionKey,
      displayName: "Hermes Session",
      derivedTitle: "Hermes Session",
      updatedAt: Date.now(),
      messages: [],
    };
    this.sessions.set(sessionKey, created);
    return created;
  }

  private async handleLocalReset(sessionKey: string, command: string) {
    const session = this.ensureSession(sessionKey);
    session.messages = [{
      role: "assistant",
      text: command === "/new" ? "Starting a fresh Hermes conversation." : "Hermes conversation reset.",
    }];
    session.updatedAt = Date.now();
    session.derivedTitle = "Hermes Session";
    const runId = `local-${Date.now()}`;
    queueMicrotask(() => {
      this.onAgentEvent?.({
        runId,
        stream: "assistant",
        data: { text: typeof session.messages[0]?.text === "string" ? session.messages[0].text : "" },
      });
      this.onChatEvent?.({
        runId,
        sessionKey,
        state: "final",
      });
      this.emitSessionUpdate(sessionKey, session);
    });
    return { runId };
  }

  private async consumeRunEvents(runId: string, controller: AbortController, sessionKey: string, userMessage: string) {
    try {
      const response = await fetch(`${this.apiBaseUrl}/runs/${runId}/events`, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Hermes run stream failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const dataLine = part
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) {
            continue;
          }
          const event = parseJsonSafely<HermesRunStreamEvent>(dataLine.slice(6));
          if (!event) {
            continue;
          }
          this.handleRunEvent(event, sessionKey, userMessage);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      this.onChatEvent?.({
        runId,
        sessionKey,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private handleRunEvent(event: HermesRunStreamEvent, sessionKey: string, userMessage: string) {
    if (event.event === "message.delta" && typeof event.delta === "string") {
      this.onAgentEvent?.({
        runId: event.run_id || "",
        stream: "assistant",
        data: { text: event.delta },
      });
      return;
    }

    if (event.event === "run.completed") {
      const session = this.ensureSession(sessionKey);
      session.messages = [
        ...session.messages,
        { role: "user", text: userMessage },
        { role: "assistant", text: event.output || "" },
      ];
      session.updatedAt = Date.now();
      session.derivedTitle = extractSessionTitle(session.messages);
      this.onChatEvent?.({
        runId: event.run_id || "",
        sessionKey,
        state: "final",
      });
      this.emitSessionUpdate(sessionKey, session);
      return;
    }

    if (event.event === "run.failed") {
      const errorMessage = typeof event.error === "string" ? event.error : "Hermes run failed.";
      this.onChatEvent?.({
        runId: event.run_id || "",
        sessionKey,
        errorMessage,
      });
    }
  }

  private emitSessionUpdate(sessionKey: string, session: HermesSessionState) {
    this.onSessionsChanged?.({
      sessionKey,
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      displayName: session.displayName,
      session: {
        key: session.key,
        sessionId: session.sessionId,
        displayName: session.displayName,
        derivedTitle: session.derivedTitle,
        updatedAt: session.updatedAt,
        lastMessagePreview: this.extractLastPreview(session.messages),
      },
    });
  }

  private extractLastPreview(messages: Array<Record<string, unknown>>) {
    const last = [...messages].reverse().find((message) => typeof message.text === "string" && message.text.trim());
    return typeof last?.text === "string" ? last.text : undefined;
  }

  private async fetchJson<T>(path: string, init?: RequestInit & { bypassV1Prefix?: boolean }) {
    const doFetch = async (url: string) => {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...this.buildHeaders(init?.headers),
        },
      });
      if (!response.ok) {
        throw new Error(`Hermes API request failed: ${response.status} at ${url}`);
      }
      return (await response.json()) as T;
    };

    let baseUrl = this.apiBaseUrl;
    if (init?.bypassV1Prefix && baseUrl.endsWith("/v1")) {
      baseUrl = baseUrl.slice(0, -3);
    }

    try {
      return await doFetch(`${baseUrl}${path}`);
    } catch (e: any) {
      if (e.message?.includes("Failed to fetch") || e.message?.includes("ECONNREFUSED")) {
         return await doFetch(`${baseUrl}${path}/`);
      }
      throw e;
    }
  }

  private buildHeaders(extra?: HeadersInit) {
    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      baseHeaders.Authorization = `Bearer ${this.apiKey}`;
    }
    if (!extra) {
      return baseHeaders;
    }
    return {
      ...baseHeaders,
      ...(extra instanceof Headers ? Object.fromEntries(extra.entries()) : extra),
    };
  }

  private emitState(status: GatewayConnectState["status"], error?: string) {
    this.onStateChange?.({ status, error });
  }
}
