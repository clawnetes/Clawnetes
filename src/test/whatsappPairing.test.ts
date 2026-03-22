import { describe, expect, it, vi } from "vitest";

import type { RemoteConfig } from "../types";
import { runWhatsAppPairingCommandFlow, type RunWhatsAppPairingCommandFlowOptions } from "../utils/whatsappPairing";

type InvokeCommand = RunWhatsAppPairingCommandFlowOptions["invokeCommand"];

describe("runWhatsAppPairingCommandFlow", () => {
  it("uses backend pairing commands and restarts the gateway after confirmation", async () => {
    const remote: RemoteConfig = {
      ip: "203.0.113.10",
      user: "root",
      password: null,
      privateKeyPath: null,
    };
    const qrUpdates: string[] = [];
    const invokeCommandMock = vi.fn(async <T = unknown>(command: string) => {
      if (command === "start_whatsapp_login") {
        return "data:image/png;base64,qr" as T;
      }
      if (command === "wait_whatsapp_login") {
        return true as T;
      }
      if (command === "restart_openclaw_gateway") {
        return null as T;
      }
      throw new Error(`unexpected command ${command}`);
    });
    const invokeCommand = invokeCommandMock as InvokeCommand;
    const waitForLinkedStatus = vi.fn(async () => true);
    const onPaired = vi.fn();

    await runWhatsAppPairingCommandFlow({
      gatewayPort: 18789,
      remote,
      invokeCommand,
      onQrCode: (value) => qrUpdates.push(value),
      onPaired,
      waitForLinkedStatus,
    });

    expect(invokeCommandMock.mock.calls).toEqual([
      ["start_whatsapp_login", { gatewayPort: 18789, remote }],
      ["wait_whatsapp_login", { gatewayPort: 18789, remote }],
      ["restart_openclaw_gateway", { remote }],
    ]);
    expect(waitForLinkedStatus).toHaveBeenCalledWith(remote, 120000);
    expect(qrUpdates).toEqual(["data:image/png;base64,qr", ""]);
    expect(onPaired).toHaveBeenCalledTimes(1);
  });

  it("accepts linked-session confirmation even when gateway wait returns false", async () => {
    const invokeCommandMock = vi.fn(async <T = unknown>(command: string) => {
      if (command === "start_whatsapp_login") {
        return "data:image/png;base64,qr" as T;
      }
      if (command === "wait_whatsapp_login") {
        return false as T;
      }
      if (command === "restart_openclaw_gateway") {
        return null as T;
      }
      throw new Error(`unexpected command ${command}`);
    });
    const invokeCommand = invokeCommandMock as InvokeCommand;
    const onPaired = vi.fn();
    const onQrCode = vi.fn();
    const waitForLinkedStatus = vi.fn(async () => true);

    await runWhatsAppPairingCommandFlow({
      gatewayPort: 18789,
      remote: null,
      invokeCommand,
      onQrCode,
      onPaired,
      waitForLinkedStatus,
    });

    expect(waitForLinkedStatus).toHaveBeenCalledWith(null, 120000);
    expect(onQrCode).toHaveBeenNthCalledWith(1, "data:image/png;base64,qr");
    expect(onQrCode).toHaveBeenNthCalledWith(2, "");
    expect(onPaired).toHaveBeenCalledTimes(1);
  });

  it("fails when both gateway wait and linked-session confirmation fail", async () => {
    const invokeCommand = vi.fn(async <T = unknown>(command: string) => {
      if (command === "start_whatsapp_login") {
        return "data:image/png;base64,qr" as T;
      }
      if (command === "wait_whatsapp_login") {
        return false as T;
      }
      return null as T;
    }) as InvokeCommand;

    await expect(
      runWhatsAppPairingCommandFlow({
        gatewayPort: 18789,
        remote: null,
        invokeCommand,
        onQrCode: vi.fn(),
        onPaired: vi.fn(),
        waitForLinkedStatus: vi.fn(async () => false),
      }),
    ).rejects.toThrow("WhatsApp login did not complete before timeout or linked-session confirmation");
  });
});
