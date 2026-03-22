import { describe, expect, it, vi } from "vitest";

import type { RemoteConfig } from "../types";
import { runWhatsAppPairingCommandFlow } from "../utils/whatsappPairing";

describe("runWhatsAppPairingCommandFlow", () => {
  it("uses backend pairing commands and restarts the gateway after confirmation", async () => {
    const remote: RemoteConfig = {
      ip: "203.0.113.10",
      user: "root",
      password: null,
      privateKeyPath: null,
    };
    const qrUpdates: string[] = [];
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "start_whatsapp_login") {
        return "data:image/png;base64,qr";
      }
      if (command === "wait_whatsapp_login") {
        return true;
      }
      if (command === "restart_openclaw_gateway") {
        return null;
      }
      throw new Error(`unexpected command ${command}`);
    });
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

    expect(invokeCommand.mock.calls).toEqual([
      ["start_whatsapp_login", { gatewayPort: 18789, remote }],
      ["wait_whatsapp_login", { gatewayPort: 18789, remote }],
      ["restart_openclaw_gateway", { remote }],
    ]);
    expect(waitForLinkedStatus).toHaveBeenCalledWith(remote, 120000);
    expect(qrUpdates).toEqual(["data:image/png;base64,qr", ""]);
    expect(onPaired).toHaveBeenCalledTimes(1);
  });

  it("fails when the gateway wait command completes without a linked session", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "start_whatsapp_login") {
        return "data:image/png;base64,qr";
      }
      if (command === "wait_whatsapp_login") {
        return false;
      }
      return null;
    });

    await expect(
      runWhatsAppPairingCommandFlow({
        gatewayPort: 18789,
        remote: null,
        invokeCommand,
        onQrCode: vi.fn(),
        onPaired: vi.fn(),
        waitForLinkedStatus: vi.fn(async () => true),
      }),
    ).rejects.toThrow("WhatsApp login did not complete before timeout");
  });
});
