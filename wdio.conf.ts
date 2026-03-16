import type { Options } from "@wdio/types";
import { spawn, ChildProcess } from "child_process";
import { resolve } from "path";

let tauriDriver: ChildProcess | null = null;

const APP_BINARY = resolve(
  __dirname,
  "src-tauri/target/release/bundle/macos/Clawnetes.app/Contents/MacOS/Clawnetes"
);

export const config: Options.Testrunner = {
  runner: "local",
  port: 4444,
  specs: ["./e2e/specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      // @ts-expect-error -- tauri:options is not in the WD types
      browserName: "safari",
      "tauri:options": {
        application: APP_BINARY,
      },
    },
  ],
  logLevel: "warn",
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },

  onPrepare() {
    tauriDriver = spawn("tauri-driver", [], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    tauriDriver.stdout?.on("data", (data: Buffer) => {
      console.log(`[tauri-driver stdout] ${data.toString().trim()}`);
    });
    tauriDriver.stderr?.on("data", (data: Buffer) => {
      console.error(`[tauri-driver stderr] ${data.toString().trim()}`);
    });

    // Give tauri-driver time to bind to port 4444
    return new Promise<void>((resolve) => setTimeout(resolve, 2000));
  },

  onComplete() {
    if (tauriDriver) {
      tauriDriver.kill();
      tauriDriver = null;
    }
  },
};
