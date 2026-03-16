import { spawn, ChildProcess } from "child_process";
import { createConnection } from "net";

let driverProcess: ChildProcess | null = null;

const TAURI_DRIVER_PORT = 4444;

/**
 * Wait until a TCP connection to the given port succeeds,
 * or time out after maxWaitMs.
 */
function waitForPort(port: number, maxWaitMs = 10000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = createConnection({ port }, () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        if (Date.now() - start > maxWaitMs) {
          reject(new Error(`tauri-driver did not start on port ${port} within ${maxWaitMs}ms`));
        } else {
          setTimeout(tryConnect, 200);
        }
      });
    };
    tryConnect();
  });
}

/**
 * Spawn `tauri-driver` and wait until it is ready to accept connections.
 */
export async function startTauriDriver(): Promise<void> {
  if (driverProcess) return;

  driverProcess = spawn("tauri-driver", [], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  driverProcess.stdout?.on("data", (data: Buffer) => {
    console.log(`[tauri-driver] ${data.toString().trim()}`);
  });

  driverProcess.stderr?.on("data", (data: Buffer) => {
    console.error(`[tauri-driver] ${data.toString().trim()}`);
  });

  driverProcess.on("exit", (code) => {
    console.log(`[tauri-driver] exited with code ${code}`);
    driverProcess = null;
  });

  await waitForPort(TAURI_DRIVER_PORT);
}

/**
 * Kill the running tauri-driver process.
 */
export function stopTauriDriver(): void {
  if (driverProcess) {
    driverProcess.kill();
    driverProcess = null;
  }
}
