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

  private emit(type: string, event?: any) {
    for (const handler of this.listeners.get(type) || []) {
      handler(event);
    }
  }
}

describe("GatewayChatClient", () => {
  beforeEach(() => {
    sentFrames.length = 0;
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

    socket?.emitChallenge();
    await connectPromise;

    expect(sentFrames[0]?.method).toBe("connect");
    expect(sentFrames[0]?.params).toMatchObject({
      role: "operator",
      auth: { token: "token-123" },
    });
  });
});
