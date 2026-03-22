import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayChatClient } from "../lib/gatewayChat";

const sentFrames: Array<{ method: string; params?: unknown }> = [];

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  private listeners = new Map<string, Array<(event?: any) => void>>();

  constructor(_url: string) {
    queueMicrotask(() => this.emit("open"));
  }

  addEventListener(type: string, handler: (event?: any) => void) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  send(raw: string) {
    const parsed = JSON.parse(raw);
    sentFrames.push({ method: parsed.method, params: parsed.params });

    if (parsed.method === "connect") {
      this.emit("message", {
        data: JSON.stringify({
          type: "res",
          id: parsed.id,
          ok: true,
          payload: { protocol: 3, auth: { role: "operator", scopes: ["operator.admin"] } },
        }),
      });
      return;
    }

    this.emit("message", {
      data: JSON.stringify({ type: "res", id: parsed.id, ok: true, payload: {} }),
    });
  }

  close() {
    this.emit("close", { code: 1000, reason: "closed" });
  }

  emitChallenge() {
    this.emit("message", {
      data: JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "nonce-123" },
      }),
    });
  }

  protected emit(type: string, event?: any) {
    for (const handler of this.listeners.get(type) || []) {
      handler(event);
    }
  }
}

describe("GatewayChatClient", () => {
  beforeEach(() => {
    sentFrames.length = 0;
    vi.useRealTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    vi.stubGlobal("navigator", {
      platform: "test-platform",
      userAgent: "vitest",
      language: "en-GB",
    });
  });

  it("waits for connect.challenge before sending connect", async () => {
    let socket: MockWebSocket | null = null;
    const TrackingWebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        socket = this;
      }
    };
    vi.stubGlobal("WebSocket", TrackingWebSocket);

    const client = new GatewayChatClient({
      wsUrl: "ws://127.0.0.1:18789",
      authToken: "token-123",
      targetEnvironment: "local",
      gatewayPort: 18789,
      tunnelActive: false,
      openClawVersion: "2.0.0",
    });

    const connectPromise = client.connect();
    await Promise.resolve();

    expect(sentFrames).toEqual([]);

    expect(socket).not.toBeNull();
    socket!.emitChallenge();
    await connectPromise;

    expect(sentFrames[0]?.method).toBe("connect");
    expect(sentFrames[0]?.params).toMatchObject({
      role: "operator",
      auth: { token: "token-123" },
    });
  });

  it("sends arbitrary RPC requests after connect", async () => {
    let socket: MockWebSocket | null = null;
    const TrackingWebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        socket = this;
      }
    };
    vi.stubGlobal("WebSocket", TrackingWebSocket);

    const client = new GatewayChatClient({
      wsUrl: "ws://127.0.0.1:18789",
      authToken: "token-123",
      targetEnvironment: "local",
      gatewayPort: 18789,
      tunnelActive: false,
      openClawVersion: "2.0.0",
    });

    const connectPromise = client.connect();
    await Promise.resolve();
    expect(socket).not.toBeNull();
    socket!.emitChallenge();
    await connectPromise;

    await client.rpc("web.login.start", { timeoutMs: 30000, force: true });

    expect(sentFrames.some((frame) => frame.method === "web.login.start")).toBe(true);
  });

  it("connects even if the gateway never emits a challenge", async () => {
    vi.useFakeTimers();
    const NoChallengeWebSocket = class extends MockWebSocket {
      send(raw: string) {
        const parsed = JSON.parse(raw);
        sentFrames.push({ method: parsed.method, params: parsed.params });
        this.emit("message", {
          data: JSON.stringify({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { protocol: 3, auth: { role: "operator", scopes: ["operator.admin"] } },
          }),
        });
      }
    };
    vi.stubGlobal("WebSocket", NoChallengeWebSocket);

    const client = new GatewayChatClient({
      wsUrl: "ws://127.0.0.1:18789",
      authToken: "token-123",
      targetEnvironment: "local",
      gatewayPort: 18789,
      tunnelActive: false,
      openClawVersion: "2.0.0",
    });

    const connectPromise = client.connect();
    await vi.advanceTimersByTimeAsync(800);
    await connectPromise;

    expect(sentFrames[0]?.method).toBe("connect");
  });

  it("fails connect when the gateway never responds", async () => {
    vi.useFakeTimers();
    const HangingWebSocket = class extends MockWebSocket {
      send(raw: string) {
        const parsed = JSON.parse(raw);
        sentFrames.push({ method: parsed.method, params: parsed.params });
      }
    };
    vi.stubGlobal("WebSocket", HangingWebSocket);

    const client = new GatewayChatClient({
      wsUrl: "ws://127.0.0.1:18789",
      authToken: "token-123",
      targetEnvironment: "local",
      gatewayPort: 18789,
      tunnelActive: false,
      openClawVersion: "2.0.0",
    });

    const connectPromise = client.connect();
    await Promise.resolve();
    const settledPromise = connectPromise.then(
      () => "resolved",
      (error) => String(error),
    );
    await vi.advanceTimersByTimeAsync(16000);

    await expect(settledPromise).resolves.toContain("Timed out connecting to the OpenClaw gateway.");
  });
});
