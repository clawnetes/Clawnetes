import type { GatewayChatBootstrap } from "../types";
import { clearDeviceAuthToken, loadDeviceAuthToken, storeDeviceAuthToken } from "./gatewayDeviceAuth";
import { loadOrCreateDeviceIdentity, signDevicePayload } from "./gatewayDeviceIdentity";
import { generateUUID } from "./gatewayUuid";

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
  status?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  runtimeMs?: number | null;
  abortedLastRun?: boolean | null;
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

export interface GatewaySessionsChangedPayload {
  sessionKey?: string | null;
  sessionId?: string | null;
  updatedAt?: number | null;
  displayName?: string | null;
  label?: string | null;
  reason?: string | null;
  phase?: string | null;
  runId?: string | null;
  ts?: number | null;
  status?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  runtimeMs?: number | null;
  abortedLastRun?: boolean | null;
  session?: GatewayChatSession | null;
}

export interface GatewayAgentEventPayload {
  runId: string;
  seq?: number;
  stream: string;
  ts?: number;
  data: Record<string, unknown>;
}

export interface GatewayConnectState {
  status:
    | "idle"
    | "connecting"
    | "challenged"
    | "authenticating"
    | "connected"
    | "reconnecting"
    | "disconnected"
    | "failed";
  error?: string;
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: any;
  error?: { code?: string; message?: string; details?: unknown };
};

type GatewayErrorInfo = {
  code: string;
  message: string;
  details?: unknown;
};

type GatewayHelloOk = {
  type?: "hello-ok";
  protocol: number;
  server?: {
    version?: string;
    connId?: string;
  };
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
  };
};

type SelectedConnectAuth = {
  authToken?: string;
  authDeviceToken?: string;
  authPassword?: string;
  resolvedDeviceToken?: string;
  storedToken?: string;
  canFallbackToShared: boolean;
};

const GATEWAY_CLIENT_ID = "openclaw-control-ui";
const GATEWAY_CLIENT_MODE = "webchat";
const ROLE = "operator";
const SCOPES = ["operator.admin", "operator.approvals", "operator.pairing"];
const CAPS = ["tool-events"];
const CONNECT_FAILED_CLOSE_CODE = 4008;
const AUTH_TOKEN_MISMATCH = "AUTH_TOKEN_MISMATCH";
const AUTH_DEVICE_TOKEN_MISMATCH = "AUTH_DEVICE_TOKEN_MISMATCH";
const CONNECT_TIMEOUT_MS = 15000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventFrame(value: unknown): value is GatewayEventFrame {
  return isObject(value) && value.type === "event" && typeof value.event === "string";
}

function isResponseFrame(value: unknown): value is GatewayResponseFrame {
  return isObject(value) && value.type === "res" && typeof value.id === "string" && typeof value.ok === "boolean";
}

function readConnectErrorDetailCode(details: unknown): string | null {
  if (!isObject(details)) {
    return null;
  }
  return typeof details.code === "string" && details.code.trim() ? details.code : null;
}

function readConnectErrorRecoveryAdvice(details: unknown): {
  canRetryWithDeviceToken?: boolean;
  recommendedNextStep?: string;
} {
  if (!isObject(details)) {
    return {};
  }
  return {
    canRetryWithDeviceToken:
      typeof details.canRetryWithDeviceToken === "boolean" ? details.canRetryWithDeviceToken : undefined,
    recommendedNextStep:
      typeof details.recommendedNextStep === "string" ? details.recommendedNextStep : undefined,
  };
}

function isNonRecoverableAuthError(error: GatewayErrorInfo | undefined) {
  const code = readConnectErrorDetailCode(error?.details);
  return (
    code === "AUTH_TOKEN_MISSING" ||
    code === "AUTH_BOOTSTRAP_TOKEN_INVALID" ||
    code === "AUTH_PASSWORD_MISSING" ||
    code === "AUTH_PASSWORD_MISMATCH" ||
    code === "AUTH_RATE_LIMITED" ||
    code === "PAIRING_REQUIRED" ||
    code === "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" ||
    code === "DEVICE_IDENTITY_REQUIRED"
  );
}

function isTrustedRetryEndpoint(url: string) {
  try {
    const gatewayUrl = new URL(url, window.location.href);
    const host = gatewayUrl.hostname.trim().toLowerCase();
    if (host === "localhost" || host === "::1" || host === "[::1]" || host === "127.0.0.1" || host.startsWith("127.")) {
      return true;
    }
    const pageUrl = new URL(window.location.href);
    return gatewayUrl.host === pageUrl.host;
  } catch {
    return false;
  }
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
}) {
  return [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
  ].join("|");
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

class GatewayRequestError extends Error {
  readonly gatewayCode: string;
  readonly details?: unknown;

  constructor(error: GatewayErrorInfo) {
    super(error.message);
    this.name = "GatewayRequestError";
    this.gatewayCode = error.code;
    this.details = error.details;
  }
}

export class GatewayChatClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private closed = false;
  private lastSeq: number | null = null;
  private reconnectTimer: number | null = null;
  private connectTimer: number | null = null;
  private backoffMs = 800;
  private connectNonce: string | null = null;
  private connectSent = false;
  private initialConnectPromise: Promise<void> | null = null;
  private resolveInitialConnect: (() => void) | null = null;
  private rejectInitialConnect: ((error: Error) => void) | null = null;
  private pendingConnectError: GatewayErrorInfo | undefined;
  private pendingDeviceTokenRetry = false;
  private deviceTokenRetryBudgetUsed = false;
  private helloReceived = false;

  onStateChange?: (state: GatewayConnectState) => void;
  onHealth?: (ok: boolean) => void;
  onChatEvent?: (payload: GatewayChatEventPayload) => void;
  onAgentEvent?: (payload: GatewayAgentEventPayload) => void;
  onSessionsChanged?: (payload: GatewaySessionsChangedPayload) => void;
  onSeqGap?: () => void;
  onReady?: (hello: GatewayHelloOk) => void;

  constructor(private bootstrap: GatewayChatBootstrap) {}

  connect() {
    if (this.initialConnectPromise) {
      return this.initialConnectPromise;
    }

    this.closed = false;
    this.emitState("connecting");
    this.initialConnectPromise = new Promise<void>((resolve, reject) => {
      this.resolveInitialConnect = resolve;
      this.rejectInitialConnect = reject;
      this.connectSocket();
    });
    return this.initialConnectPromise;
  }

  disconnect() {
    this.closed = true;
    this.clearReconnectTimer();
    this.clearConnectTimer();
    for (const pending of this.pending.values()) {
      pending.reject(new Error("gateway client disconnected"));
    }
    this.pending.clear();
    this.rejectConnect(new Error("gateway client disconnected"));
    this.ws?.close();
    this.ws = null;
    this.helloReceived = false;
  }

  async listAgents(): Promise<{ defaultId?: string; agents: GatewayChatAgent[] }> {
    const payload = await this.request<{ defaultId?: string; agents?: GatewayChatAgent[] }>("agents.list", {});
    return {
      defaultId: typeof payload?.defaultId === "string" ? payload.defaultId : undefined,
      agents: Array.isArray(payload?.agents) ? payload.agents : [],
    };
  }

  async listSessions(agentId?: string): Promise<{ sessions: GatewayChatSession[] }> {
    const payload = await this.request<{ sessions?: GatewayChatSession[] }>("sessions.list", {
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

  async loadHistory(sessionKey: string): Promise<GatewayChatHistoryPayload> {
    return await this.request("chat.history", { sessionKey, limit: 200 });
  }

  async sendChat(
    sessionKey: string,
    message: string,
    thinking = "adaptive",
  ): Promise<{ runId: string }> {
    return await this.request("chat.send", {
      sessionKey,
      message,
      thinking,
      timeoutMs: 30000,
      idempotencyKey: generateUUID(),
    });
  }

  async abortChat(sessionKey: string, runId: string) {
    return await this.request("chat.abort", { sessionKey, runId });
  }

  async resetSession(sessionKey: string) {
    return await this.request("sessions.reset", { key: sessionKey });
  }

  async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    return await this.request<T>(method, params);
  }

  private connectSocket() {
    if (this.closed) {
      return;
    }

    this.connectNonce = null;
    this.connectSent = false;
    this.helloReceived = false;
    this.pendingConnectError = undefined;

    const ws = new WebSocket(this.bootstrap.wsUrl);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.emitState(this.initialConnectPromise ? "connecting" : "reconnecting");
      this.queueConnect();
    });

    ws.addEventListener("message", (event) => {
      this.handleMessage(typeof event.data === "string" ? event.data : String(event.data ?? ""));
    });

    ws.addEventListener("close", (event) => {
      this.ws = null;
      this.clearConnectTimer();
      const closeEvent = (event ?? {}) as { code?: number; reason?: string };

      const connectError = this.pendingConnectError;
      this.pendingConnectError = undefined;
      const closeError = new Error(
        connectError?.message || `gateway closed (${closeEvent.code ?? 1000}): ${String(closeEvent.reason ?? "unknown")}`,
      );

      for (const pending of this.pending.values()) {
        pending.reject(closeError);
      }
      this.pending.clear();

      if (this.closed) {
        this.emitState("disconnected");
        this.rejectConnect(closeError);
        return;
      }

      const connectErrorCode = readConnectErrorDetailCode(connectError?.details);
      if (
        connectErrorCode === AUTH_TOKEN_MISMATCH &&
        this.deviceTokenRetryBudgetUsed &&
        !this.pendingDeviceTokenRetry
      ) {
        this.emitState("failed", closeError.message);
        this.rejectConnect(closeError);
        return;
      }

      if (isNonRecoverableAuthError(connectError)) {
        this.emitState("failed", closeError.message);
        this.rejectConnect(closeError);
        return;
      }

      if (this.initialConnectPromise) {
        this.emitState("failed", closeError.message);
        this.rejectConnect(closeError);
        return;
      }

      this.emitState("reconnecting", closeError.message);
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      if (!this.helloReceived) {
        this.emitState("reconnecting", "Failed to connect to the OpenClaw gateway.");
      }
    });
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    this.clearReconnectTimer();
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15000);
    this.reconnectTimer = window.setTimeout(() => {
      this.connectSocket();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectTimer() {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    this.clearConnectTimer();
    this.connectTimer = window.setTimeout(() => {
      void this.sendConnect();
    }, 750);
  }

  private async sendConnect() {
    if (this.connectSent) {
      return;
    }

    this.connectSent = true;
    this.clearConnectTimer();
    this.emitState("authenticating");

    const isSecureContext = typeof crypto !== "undefined" && !!crypto.subtle;
    const explicitGatewayToken = this.bootstrap.authToken?.trim() || undefined;
    let deviceIdentity: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>> | null = null;
    let selectedAuth: SelectedConnectAuth = {
      authToken: explicitGatewayToken,
      canFallbackToShared: false,
    };

    if (isSecureContext) {
      deviceIdentity = await loadOrCreateDeviceIdentity();
      selectedAuth = this.selectConnectAuth({
        role: ROLE,
        deviceId: deviceIdentity.deviceId,
      });
      if (this.pendingDeviceTokenRetry && selectedAuth.authDeviceToken) {
        this.pendingDeviceTokenRetry = false;
      }
    }

    const authToken = selectedAuth.authToken;
    const deviceToken = selectedAuth.authDeviceToken ?? selectedAuth.resolvedDeviceToken;
    const auth =
      authToken || selectedAuth.authPassword
        ? {
            token: authToken,
            deviceToken,
            password: selectedAuth.authPassword,
          }
        : undefined;

    let device:
      | {
          id: string;
          publicKey: string;
          signature: string;
          signedAt: number;
          nonce: string;
        }
      | undefined;

    if (isSecureContext && deviceIdentity) {
      const signedAtMs = Date.now();
      const nonce = this.connectNonce ?? "";
      const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: GATEWAY_CLIENT_ID,
        clientMode: GATEWAY_CLIENT_MODE,
        role: ROLE,
        scopes: SCOPES,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      });
      const signature = await signDevicePayload(deviceIdentity.privateKey, payload);
      device = {
        id: deviceIdentity.deviceId,
        publicKey: deviceIdentity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    }

    void this.withTimeout(
      this.request<GatewayHelloOk>("connect", {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: GATEWAY_CLIENT_ID,
        version: "clawnetes",
        platform: navigator.platform || "unknown",
        mode: GATEWAY_CLIENT_MODE,
        instanceId: generateUUID(),
      },
      role: ROLE,
      scopes: SCOPES,
      device,
      caps: CAPS,
      auth,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    }),
      CONNECT_TIMEOUT_MS,
      "Timed out connecting to the OpenClaw gateway.",
    )
      .then((hello) => {
        this.pendingDeviceTokenRetry = false;
        this.deviceTokenRetryBudgetUsed = false;
        this.pendingConnectError = undefined;
        this.backoffMs = 800;
        this.helloReceived = true;
        this.emitState("connected");
        if (hello?.auth?.deviceToken && deviceIdentity) {
          storeDeviceAuthToken({
            deviceId: deviceIdentity.deviceId,
            role: hello.auth.role ?? ROLE,
            token: hello.auth.deviceToken,
            scopes: hello.auth.scopes ?? [],
          });
        }
        this.resolveConnect();
        this.onReady?.(hello);
      })
      .catch((error: unknown) => {
        const connectErrorCode = error instanceof GatewayRequestError ? readConnectErrorDetailCode(error.details) : null;
        const recoveryAdvice =
          error instanceof GatewayRequestError ? readConnectErrorRecoveryAdvice(error.details) : {};
        const retryWithDeviceTokenRecommended =
          recoveryAdvice.recommendedNextStep === "retry_with_device_token";
        const canRetryWithDeviceTokenHint =
          recoveryAdvice.canRetryWithDeviceToken === true ||
          retryWithDeviceTokenRecommended ||
          connectErrorCode === AUTH_TOKEN_MISMATCH;
        const shouldRetryWithDeviceToken =
          !this.deviceTokenRetryBudgetUsed &&
          !selectedAuth.authDeviceToken &&
          Boolean(explicitGatewayToken) &&
          Boolean(deviceIdentity) &&
          Boolean(selectedAuth.storedToken) &&
          canRetryWithDeviceTokenHint &&
          isTrustedRetryEndpoint(this.bootstrap.wsUrl);

        if (shouldRetryWithDeviceToken) {
          this.pendingDeviceTokenRetry = true;
          this.deviceTokenRetryBudgetUsed = true;
        }

        if (error instanceof GatewayRequestError) {
          this.pendingConnectError = {
            code: error.gatewayCode,
            message: error.message,
            details: error.details,
          };
        } else {
          this.pendingConnectError = {
            code: "UNAVAILABLE",
            message: error instanceof Error ? error.message : String(error),
          };
        }

        if (
          selectedAuth.canFallbackToShared &&
          deviceIdentity &&
          connectErrorCode === AUTH_DEVICE_TOKEN_MISMATCH
        ) {
          clearDeviceAuthToken({ deviceId: deviceIdentity.deviceId, role: ROLE });
        }

        this.ws?.close(CONNECT_FAILED_CLOSE_CODE, "connect failed");
      });
  }

  private async request<T = unknown>(method: string, params?: unknown, id = generateUUID()): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }

    const payload = { type: "req", id, method, params };
    const response = new Promise<T>((resolve, reject) => {
      let timer: number | undefined;

      const cleanup = () => {
        if (timer !== undefined) {
          window.clearTimeout(timer);
        }
        this.pending.delete(id);
      };

      timer = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Gateway request timed out: ${method}`));
      }, 30000);

      this.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value as T);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
    });

    try {
      this.ws.send(JSON.stringify(payload));
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }

    return await response;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
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
        pending.reject(
          new GatewayRequestError({
            code: parsed.error?.code ?? "UNAVAILABLE",
            message: parsed.error?.message ?? "gateway request failed",
            details: parsed.error?.details,
          }),
        );
      }
      return;
    }

    if (!isEventFrame(parsed)) {
      return;
    }

    if (parsed.event === "connect.challenge") {
      const nonce = isObject(parsed.payload) && typeof parsed.payload.nonce === "string" ? parsed.payload.nonce : null;
      if (nonce) {
        this.connectNonce = nonce;
        this.emitState("challenged");
        void this.sendConnect();
      }
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
      this.onAgentEvent?.(parsed.payload as unknown as GatewayAgentEventPayload);
      return;
    }

    if (parsed.event === "sessions.changed" && isObject(parsed.payload)) {
      this.onSessionsChanged?.(parsed.payload as GatewaySessionsChangedPayload);
    }
  }

  private selectConnectAuth(params: { role: string; deviceId: string }): SelectedConnectAuth {
    const explicitGatewayToken = this.bootstrap.authToken?.trim() || undefined;
    const storedToken = loadDeviceAuthToken({
      deviceId: params.deviceId,
      role: params.role,
    })?.token;
    const shouldUseDeviceRetryToken =
      this.pendingDeviceTokenRetry &&
      Boolean(explicitGatewayToken) &&
      Boolean(storedToken) &&
      isTrustedRetryEndpoint(this.bootstrap.wsUrl);
    const resolvedDeviceToken = !explicitGatewayToken ? (storedToken ?? undefined) : undefined;
    const authToken = explicitGatewayToken ?? resolvedDeviceToken;

    return {
      authToken,
      authDeviceToken: shouldUseDeviceRetryToken ? (storedToken ?? undefined) : undefined,
      resolvedDeviceToken,
      storedToken: storedToken ?? undefined,
      canFallbackToShared: Boolean(storedToken && explicitGatewayToken),
    };
  }

  private emitState(status: GatewayConnectState["status"], error?: string) {
    this.onStateChange?.({ status, error });
  }

  private resolveConnect() {
    this.resolveInitialConnect?.();
    this.resolveInitialConnect = null;
    this.rejectInitialConnect = null;
    this.initialConnectPromise = null;
  }

  private rejectConnect(error: Error) {
    this.rejectInitialConnect?.(error);
    this.resolveInitialConnect = null;
    this.rejectInitialConnect = null;
    this.initialConnectPromise = null;
  }
}
