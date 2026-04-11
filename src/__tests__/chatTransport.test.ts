import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatTransportClient } from "../lib/chatTransport";
import { HermesChatTransport } from "../lib/hermesChatTransport";

describe("createChatTransportClient", () => {
  it("creates a Hermes transport when the bootstrap uses hermes-api", () => {
    const client = createChatTransportClient({
      wsUrl: "",
      authToken: "hermes-key",
      targetEnvironment: "local",
      gatewayPort: 8642,
      tunnelActive: false,
      openClawVersion: "Hermes Agent",
      platform: "hermes",
      chatTransport: "hermes-api",
      apiBaseUrl: "http://127.0.0.1:8642/v1",
      apiKey: "hermes-key",
      supportsRuns: true,
      supportsAgentDiscovery: false,
    });

    expect(client).toBeInstanceOf(HermesChatTransport);
  });
});

describe("HermesChatTransport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("connects over the Hermes health endpoint, discovers a default agent, and streams run events", async () => {
    const fetchMock = vi.fn();
    const encoder = new TextEncoder();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", platform: "hermes-agent" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        object: "list",
        data: [{ id: "hermes-agent", owned_by: "hermes" }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ run_id: "run-123", status: "started" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode("data: {\"event\":\"message.delta\",\"run_id\":\"run-123\",\"delta\":\"Hello\"}\n\n"));
            controller.enqueue(encoder.encode("data: {\"event\":\"run.completed\",\"run_id\":\"run-123\",\"output\":\"Hello from Hermes\"}\n\n"));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const transport = new HermesChatTransport({
      wsUrl: "",
      authToken: "hermes-key",
      targetEnvironment: "local",
      gatewayPort: 8642,
      tunnelActive: false,
      openClawVersion: "Hermes Agent",
      platform: "hermes",
      chatTransport: "hermes-api",
      apiBaseUrl: "http://127.0.0.1:8642/v1",
      apiKey: "hermes-key",
      supportsRuns: true,
      supportsAgentDiscovery: false,
    });

    const states: string[] = [];
    const deltas: string[] = [];
    const chatStates: string[] = [];

    transport.onStateChange = (state) => {
      states.push(state.status);
    };
    transport.onAgentEvent = (event) => {
      if (typeof event.data.text === "string") {
        deltas.push(event.data.text);
      }
    };
    transport.onChatEvent = (event) => {
      if (event.state) {
        chatStates.push(event.state);
      }
    };

    await transport.connect();

    const agents = await transport.listAgents();
    expect(agents.defaultId).toBe("hermes-agent");
    expect(agents.agents).toEqual([{ id: "hermes-agent", name: "hermes-agent" }]);

    const result = await transport.sendChat("main", "Hello Hermes");
    expect(result).toEqual({ runId: "run-123" });

    await Promise.resolve();
    await Promise.resolve();

    const history = await transport.loadHistory("main");

    expect(states).toContain("connected");
    expect(deltas).toContain("Hello");
    expect(chatStates).toContain("final");
    expect(history.messages).toEqual([
      { role: "user", text: "Hello Hermes" },
      { role: "assistant", text: "Hello from Hermes" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8642/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer hermes-key",
        }),
      }),
    );
  });
});
