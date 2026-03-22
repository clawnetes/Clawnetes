import { describe, expect, it } from "vitest";

import { REMOTE_TUNNEL_ACCESS_PORT, resolveGatewayAccessPort } from "../lib/gatewayPorts";

describe("gatewayPorts", () => {
  it("keeps the configured local gateway port for local sessions", () => {
    expect(resolveGatewayAccessPort("local", 18789)).toBe(18789);
  });

  it("uses the dedicated tunnel access port for remote sessions", () => {
    expect(resolveGatewayAccessPort("cloud", 18789)).toBe(REMOTE_TUNNEL_ACCESS_PORT);
    expect(REMOTE_TUNNEL_ACCESS_PORT).toBe(28789);
  });
});
