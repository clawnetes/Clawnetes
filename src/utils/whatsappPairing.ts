import type { RemoteConfig } from "../types";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

export interface RunWhatsAppPairingCommandFlowOptions {
  gatewayPort: number;
  remote: RemoteConfig | null;
  invokeCommand: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
  onQrCode: (qrDataUrl: string) => void;
  onPaired: () => void;
  waitForLinkedStatus: (remote: RemoteConfig | null, timeoutMs?: number) => Promise<boolean>;
}

export async function runWhatsAppPairingCommandFlow({
  gatewayPort,
  remote,
  invokeCommand,
  onQrCode,
  onPaired,
  waitForLinkedStatus,
}: RunWhatsAppPairingCommandFlowOptions): Promise<void> {
  const qrDataUrl = await withTimeout(
    invokeCommand<string>("start_whatsapp_login", {
      gatewayPort,
      remote,
    }),
    35000,
    "Timed out waiting for the gateway to return a WhatsApp QR code.",
  );

  if (!qrDataUrl) {
    throw new Error("Gateway returned ok but no QR code (already linked?)");
  }

  onQrCode(qrDataUrl);

  const connected = await withTimeout(
    invokeCommand<boolean>("wait_whatsapp_login", {
      gatewayPort,
      remote,
    }),
    130000,
    "Timed out waiting for WhatsApp pairing to complete.",
  );

  const linked = await withTimeout(
    waitForLinkedStatus(remote, 120000),
    125000,
    "Timed out confirming WhatsApp linked status.",
  );

  if (!connected && !linked) {
    throw new Error("WhatsApp login did not complete before timeout or linked-session confirmation");
  }

  onQrCode("");
  onPaired();
  await invokeCommand("restart_openclaw_gateway", { remote });
}
