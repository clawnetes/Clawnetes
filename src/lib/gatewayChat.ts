import type { GatewayChatBootstrap } from "../types";

export interface GatewayChatAgent {
  id: string;
  name?: string;
}

export interface GatewayChatSession {
  key: string;
  displayName?: string;
  updatedAt?: number | null;
  sessionId?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  model?: string;
  thinkingLevel?: string;
}

export interface GatewayChatHistoryPayload {
  sessionKey: string;
  sessionId?: string | null;
  messages?: unknown[];
  thinkingLevel?: string | null;
}

export interface GatewayChatEventPayload {
  runId?: string | null;
  sessionKey?: string | null;
  state?: string | null;
  message?: unknown;
  errorMessage?: string | null;
}

export interface GatewayAgentEventPayload {
  runId: string;
  seq?: number;
  stream: string;
  ts?: number;
  data: Record<string, unknown>;
}

export interface GatewayConnectState {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";
  error?: string;
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type EventFrame = {
  type: "evt";
  event: string;
  payload?: unknown;
  seq?: number;
};

type ResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: any;
  error?: { message?: string };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventFrame(value: unknown): value is EventFrame {
  return isObject(value) && value.type === "evt" && typeof value.event === "string";
}

function isResponseFrame(value: unknown): value is ResponseFrame {
  return isObject(value) && value.type === "res" && typeof value.id === "string" && typeof value.ok === "boolean";
}

export function extractMessageText(raw: unknown): string {
  if (!isObject(raw)) return "";
  if (typeof raw.text === "string") return raw.text;
  if (typeof raw.content === "string") return raw.content;

  if (Array.isArray(raw.content)) {
    return raw.content
      .map((part) => {
        if (!isObject(part)) return "";
        if (typeof part.text === "string") return part.text;
        if (typeof part.type === "string" && part.type === "input_text" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

export class GatewayChatClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private reconnectTimer: number | null = null;
  private closed = false;
  private lastSeq: number | null = null;

  onStateChange?: (state: GatewayConnectState) => void;
  onHealth?: (ok: boolean) => void;
  onChatEvent?: (payload: GatewayChatEventPayload) => void;
  onAgentEvent?: (payload: GatewayAgentEventPayload) => void;
  onSeqGap?: () => void;

  constructor(private bootstrap: GatewayChatBootstrap) {}

  async connect() {
    this.closed = false;
    this.emitState("connecting");
    await this.openSocket();
  }

  disconnect() {
    this.closed = true;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const pending of this.pending.values()) {
      pending.reject(new Error("gateway client disconnected"));
    }
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
  }

  async listAgents(): Promise<{ defaultId?: string; agents: GatewayChatAgent[] }> {
    const payload = await this.request("agents.list", {});
    return {
      defaultId: typeof payload?.defaultId === "string" ? payload.defaultId : undefined,
      agents: Array.isArray(payload?.agents) ? payload.agents : [],
    };
  }

  async listSessions(agentId?: string): Promise<{ sessions: GatewayChatSession[] }> {
    const payload = await this.request("sessions.list", {
      includeGlobal: true,
      includeUnknown: false,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 80,
      ...(agentId ? { agentId } : {}),
    });
    return {
      sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
    };
  }

  async createSession(agentId?: string): Promise<{ key: string }> {
    return await this.request("sessions.create", {
      ...(agentId ? { agentId } : {}),
    });
  }

  async loadHistory(sessionKey: string): Promise<GatewayChatHistoryPayload> {
    return await this.request("chat.history", { sessionKey, limit: 200 });
  }

  async sendChat(sessionKey: string, message: string, thinking = "adaptive"): Promise<{ runId: string }> {
    return await this.request("chat.send", {
      sessionKey,
      message,
      thinking,
      timeoutMs: 30000,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  async abortChat(sessionKey: string, runId: string) {
    return await this.request("chat.abort", { sessionKey, runId });
  }

  async resetSession(sessionKey: string) {
    return await this.request("sessions.reset", { key: sessionKey });
  }

  private async openSocket() {
    const ws = new WebSocket(this.bootstrap.wsUrl);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", async () => {
        this.emitState("connecting");
        try {
          await this.sendConnect();
          this.emitState("connected");
          resolve();
        } catch (error) {
          const message = String(error);
          this.emitState("error", message);
          reject(new Error(message));
        }
      });

      ws.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });

      ws.addEventListener("close", () => {
        this.ws = null;
        if (this.closed) {
          this.emitState("disconnected");
          return;
        }
        this.emitState("reconnecting");
        this.reconnectTimer = window.setTimeout(() => {
          void this.openSocket();
        }, 2000);
      });

      ws.addEventListener("error", () => {
        this.emitState("error", "Failed to connect to the OpenClaw gateway.");
      });
    });
  }

  private async sendConnect() {
    await this.request(
      "connect",
      {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "clawnetes-chat",
          displayName: "clawnetes-chat",
          version: "1.0.0",
          platform: navigator.platform || "unknown",
          mode: "ui",
          instanceId: crypto.randomUUID(),
        },
        auth: {
          token: this.bootstrap.authToken,
        },
        role: "operator",
        scopes: ["operator.admin"],
      },
      "connect-1",
    );
  }

  private async request(method: string, params: Record<string, unknown>, id = this.nextId()) {
    const payload = {
      type: "req",
      id,
      method,
      params,
    };

    return await new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.sendRaw(payload);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private sendRaw(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway socket is not connected");
    }
    this.ws.send(JSON.stringify(payload));
  }

  private handleMessage(raw: any) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }

    if (isResponseFrame(parsed)) {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }
      this.pending.delete(parsed.id);
      if (parsed.ok) {
        pending.resolve(parsed.payload);
      } else {
        const error = new Error(parsed.error?.message || "gateway request failed");
        pending.reject(error);
      }
      return;
    }

    if (!isEventFrame(parsed)) {
      return;
    }

    if (typeof parsed.seq === "number") {
      if (this.lastSeq != null && parsed.seq > this.lastSeq + 1) {
        this.onSeqGap?.();
      }
      this.lastSeq = parsed.seq;
    }

    if (parsed.event === "health") {
      const ok = isObject(parsed.payload) && typeof parsed.payload.ok === "boolean" ? parsed.payload.ok : true;
      this.onHealth?.(ok);
      return;
    }

    if (parsed.event === "chat" && isObject(parsed.payload)) {
      this.onChatEvent?.(parsed.payload as GatewayChatEventPayload);
      return;
    }

    if (parsed.event === "agent" && isObject(parsed.payload)) {
      this.onAgentEvent?.(parsed.payload as GatewayAgentEventPayload);
    }
  }

  private emitState(status: GatewayConnectState["status"], error?: string) {
    this.onStateChange?.({ status, error });
  }

  private nextId() {
    this.requestCounter += 1;
    return this.requestCounter === 1 ? "connect-1" : `req-${this.requestCounter}`;
  }
}
