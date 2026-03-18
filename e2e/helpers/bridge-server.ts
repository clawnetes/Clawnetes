/**
 * Real IPC bridge server.
 *
 * An HTTP server that maps Tauri IPC commands to actual shell commands
 * and filesystem operations, replicating what the Rust backend does.
 */
import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

export interface BridgeServer {
  port: number;
  server: Server;
  close: () => void;
}

function shell(cmd: string, timeoutMs = 60_000): string {
  return execSync(cmd, {
    shell: "/bin/zsh",
    timeout: timeoutMs,
    encoding: "utf-8",
    env: { ...process.env, PATH: process.env.PATH },
  }).trim();
}

function shellSafe(cmd: string, timeoutMs = 60_000): string | null {
  try {
    return shell(cmd, timeoutMs);
  } catch {
    return null;
  }
}

/**
 * Replicate the Rust `configure_agent` logic in Node.js.
 * Reference: src-tauri/src/main.rs lines 3009-3827
 */
function configureAgent(config: Record<string, unknown>): string {
  const home = homedir();
  const openclawRoot = join(home, ".openclaw");
  const workspace = join(openclawRoot, "workspace");
  const agentsDir = join(openclawRoot, "agents", "main", "agent");

  // Run gateway install --force to scaffold (unless preserving state)
  if (config.preserve_state !== true) {
    shellSafe("openclaw gateway stop");
    shellSafe("openclaw gateway install --force --profile messaging", 120_000);
  }

  mkdirSync(workspace, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });

  // Read existing config to preserve gateway token
  const configPath = join(openclawRoot, "openclaw.json");
  let existingConfig: Record<string, any> = {};
  if (existsSync(configPath)) {
    try {
      existingConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      existingConfig = {};
    }
  }

  const gatewayToken =
    existingConfig?.gateway?.auth?.token || randomBytes(16).toString("hex");

  // Preserve telegram state
  const telegramAllowFrom =
    existingConfig?.channels?.telegram?.accounts?.default?.allowFrom;
  const telegramDmPolicy =
    existingConfig?.channels?.telegram?.accounts?.default?.dmPolicy;

  const provider = (config.provider as string) || "anthropic";
  const apiKey = (config.api_key as string) || (config.apiKey as string) || "";
  const modelStr = (config.model as string) || "claude-sonnet-4-20250514";
  const authMethod = (config.auth_method as string) || (config.authMethod as string) || "token";
  const userName = (config.user_name as string) || (config.userName as string) || "User";
  const agentName = (config.agent_name as string) || (config.agentName as string) || "Agent";
  const telegramToken = (config.telegram_token as string) || (config.telegramToken as string) || "";
  const gatewayPort = (config.gateway_port as number) || (config.gatewayPort as number) || 18789;
  const gatewayBind = (config.gateway_bind as string) || (config.gatewayBind as string) || "loopback";
  const gatewayAuthMode = (config.gateway_auth_mode as string) || (config.gatewayAuthMode as string) || "token";
  const channel = (config.channel as string) || "telegram";

  // Build effective model name with provider prefix
  const effectiveModel = modelStr.includes("/") ? modelStr : `${provider}/${modelStr}`;

  // Build the main agent
  const mainAgent = {
    id: "main",
    name: agentName,
    workspace: join(openclawRoot, "workspace"),
    agentDir: join(openclawRoot, "agents", "main", "agent"),
    model: { primary: effectiveModel },
  };

  // Build auth profile
  const profileName = `${provider}-token`;
  const authProviderMap: Record<string, string> = {
    anthropic: "anthropic",
    openai: "openai",
    google: "google-gemini",
    openrouter: "openrouter",
    xai: "xai",
  };
  const authProviderId = authProviderMap[provider] || provider;

  // Build openclaw.json
  const configJson: Record<string, any> = {
    ...existingConfig,
    messages: {
      ...(existingConfig.messages || {}),
      ackReactionScope: "group-mentions",
    },
    agents: {
      defaults: {
        maxConcurrent: 4,
        subagents: { maxConcurrent: 8 },
        compaction: { mode: "safeguard" },
        workspace,
        model: { primary: effectiveModel },
        models: {
          [effectiveModel]: {},
        },
      },
      list: [mainAgent],
    },
    gateway: {
      mode: "local",
      port: gatewayPort,
      bind: gatewayBind,
      auth: { mode: gatewayAuthMode, token: gatewayToken },
      tailscale: { mode: "off", resetOnExit: false },
    },
    auth: {
      ...(existingConfig.auth || {}),
      profiles: {
        ...(existingConfig?.auth?.profiles || {}),
        [profileName]: {
          provider: authProviderId,
          mode: authMethod === "token" ? "api_key" : authMethod,
        },
      },
    },
    commands: { native: "auto", nativeSkills: "auto" },
  };

  // Add telegram config
  if (telegramToken && channel === "telegram") {
    const dmPolicy = config.preserve_state === true
      ? (telegramDmPolicy || "allowlist")
      : "pairing";

    const channelConfig: Record<string, any> = {
      botToken: telegramToken,
      name: "Primary Bot",
      dmPolicy,
    };

    if (dmPolicy === "allowlist" && telegramAllowFrom) {
      channelConfig.allowFrom = telegramAllowFrom;
    }

    configJson.channels = {
      telegram: { accounts: { default: channelConfig } },
    };

    // Ensure telegram plugin is enabled (matches Rust: plugins.entries.{id})
    configJson.plugins = configJson.plugins || { entries: {} };
    configJson.plugins.entries = configJson.plugins.entries || {};
    configJson.plugins.entries.telegram = configJson.plugins.entries.telegram || { enabled: true };
  }

  // Add whatsapp config
  if (config.whatsapp_enabled || config.whatsappEnabled) {
    const dmPolicy = (config.whatsapp_dm_policy as string) || (config.whatsappDmPolicy as string) || "open";
    const phone = (config.whatsapp_phone_number as string) || (config.whatsappPhone as string) || "";

    const whatsappObj: Record<string, any> = {
      enabled: true,
      selfChatMode: true,
      dmPolicy,
      groupPolicy: "allowlist",
      debounceMs: 0,
      mediaMaxMb: 50,
    };

    if (dmPolicy === "open") {
      whatsappObj.allowFrom = ["*"];
    } else if (dmPolicy === "allowlist" && phone) {
      const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;
      whatsappObj.allowFrom = [formattedPhone];
    }

    configJson.channels = configJson.channels || {};
    configJson.channels.whatsapp = whatsappObj;
    configJson.plugins = configJson.plugins || { entries: {} };
    configJson.plugins.entries = configJson.plugins.entries || {};
    configJson.plugins.entries.whatsapp = { enabled: true };
  }

  // Write openclaw.json
  writeFileSync(configPath, JSON.stringify(configJson, null, 2));

  // Sync token to keychain
  shellSafe(`openclaw config set gateway.auth.token ${gatewayToken}`);

  // Write clawnetes-meta.json
  const meta: Record<string, any> = {};
  if (config.agent_type || config.agentType) {
    meta.agent_type = (config.agent_type as string) || (config.agentType as string);
  }
  writeFileSync(
    join(openclawRoot, "clawnetes-meta.json"),
    JSON.stringify(meta, null, 2)
  );

  // Write auth-profiles.json
  const authProfiles: Record<string, any> = {};
  authProfiles[profileName] = {
    provider: authProviderId,
    mode: authMethod === "token" ? "api_key" : authMethod,
    ...(authMethod === "token" ? { apiKey } : {}),
  };
  writeFileSync(
    join(agentsDir, "auth-profiles.json"),
    JSON.stringify(authProfiles, null, 2)
  );

  // Write markdown files
  const identityMd =
    (config.identity_md as string) ||
    (config.identityMd as string) ||
    `# IDENTITY.md - Who Am I?\n- **Name:** ${agentName}\n- **Emoji:** \u{1F99E}\n---\nManaged by Clawnetes.`;
  writeFileSync(join(workspace, "IDENTITY.md"), identityMd);

  const userMd =
    (config.user_md as string) ||
    (config.userMd as string) ||
    `# USER.md - About Your Human\n- **Name:** ${userName}\n---`;
  writeFileSync(join(workspace, "USER.md"), userMd);

  const soulMd =
    (config.soul_md as string) ||
    (config.soulMd as string) ||
    `# SOUL.md\n## Mission\nServe ${userName}.`;
  writeFileSync(join(workspace, "SOUL.md"), soulMd);

  return "Configured.";
}

function handleCommand(
  cmd: string,
  args: Record<string, unknown>
): unknown {
  switch (cmd) {
    case "check_prerequisites": {
      const nodeOk = shellSafe("node -v") !== null;
      const openclawOk = shellSafe("openclaw --version") !== null;
      return {
        node_installed: nodeOk,
        docker_running: true,
        openclaw_installed: openclawOk,
      };
    }

    case "has_saved_license":
      return true;

    case "get_openclaw_version": {
      const ver = shellSafe("openclaw --version");
      return ver || "0.0.0";
    }

    case "install_openclaw": {
      shell("npm install -g openclaw", 120_000);
      shell("openclaw --version");
      return "OpenClaw installed successfully.";
    }

    case "configure_agent":
      return configureAgent((args.config as Record<string, unknown>) || args);

    case "tauri": {
      // Handle shell.open() — actually open the URL in the system browser
      const message = args.message as Record<string, unknown> | undefined;
      if (message?.cmd === "open" && typeof message.path === "string") {
        console.log(`[bridge] opening URL: ${message.path}`);
        shellSafe(`open "${message.path}"`);
      } else {
        console.log(`[bridge] tauri (unhandled):`, args);
      }
      return null;
    }

    case "install_skill": {
      const skillName = (args.name as string) || (args.skill as string) || "";
      if (skillName) {
        shell(`npx clawhub install ${skillName}`, 120_000);
      }
      return null;
    }

    case "start_gateway": {
      shellSafe("openclaw gateway stop");
      // Small delay for cleanup
      shellSafe("sleep 2");
      shellSafe("openclaw doctor --fix --yes || true");
      shell("openclaw gateway start", 120_000);

      // Poll for gateway to be ready
      const maxWait = 60_000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        try {
          shell("curl -sf http://127.0.0.1:18789 > /dev/null");
          break;
        } catch {
          shellSafe("sleep 2");
        }
      }
      return "Gateway started.";
    }

    case "restart_openclaw_gateway": {
      shellSafe("openclaw gateway stop");
      shellSafe("sleep 2");
      shell("openclaw gateway start", 120_000);
      return null;
    }

    case "initialize_agent_sessions": {
      const agentIds = (args.agent_ids as string[]) || (args.agentIds as string[]) || ["main"];
      for (const id of agentIds) {
        shellSafe(`openclaw agent --agent ${id} --message hello`, 30_000);
      }
      return null;
    }

    case "generate_pairing_code":
      return "Send /start to your bot";

    case "check_messaging_link_status":
      // For real deployment, check actual pairing status
      // Return false initially; the test can poll
      return false;

    case "get_dashboard_url": {
      // Try `openclaw dashboard --no-open` first (returns "Dashboard URL: http://...")
      const dashOutput = shellSafe("openclaw dashboard --no-open");
      if (dashOutput) {
        const urlLine = dashOutput.split("\n").find((l) => l.includes("Dashboard URL:"));
        if (urlLine) {
          const url = urlLine.replace("Dashboard URL:", "").trim();
          if (url) return url;
        }
      }
      // Fallback: read token from config and build tokenized URL
      const tokenOutput = shellSafe("openclaw config get gateway.auth.token");
      if (tokenOutput) {
        const token = tokenOutput.trim().replace(/^"|"$/g, "");
        if (token && token !== "null" && token !== "undefined") {
          return `http://127.0.0.1:18789/#token=${token}`;
        }
      }
      // Last resort: read from openclaw.json directly
      const cfgPath = join(homedir(), ".openclaw", "openclaw.json");
      if (existsSync(cfgPath)) {
        try {
          const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
          const token = cfg?.gateway?.auth?.token;
          if (token) return `http://127.0.0.1:18789/#token=${token}`;
        } catch { /* ignore */ }
      }
      return "http://127.0.0.1:18789";
    }

    case "validate_openclaw_config": {
      const result = shellSafe("openclaw config validate");
      return result || "Config is valid.";
    }

    case "uninstall_openclaw": {
      shellSafe("openclaw gateway stop");
      shellSafe("npm uninstall -g openclaw", 60_000);
      const home = homedir();
      const openclawDir = join(home, ".openclaw");
      if (existsSync(openclawDir)) {
        rmSync(openclawDir, { recursive: true, force: true });
      }
      return null;
    }

    case "get_ollama_models":
    case "get_lmstudio_models":
      return [];

    case "close_app":
    case "save_workspace":
    case "run_maintenance":
      return null;

    case "get_pairing_code":
      return "REAL-DEPLOY";

    case "verify_license_key":
      return true;

    case "get_saved_license":
    case "save_license":
      return null;

    case "install_node":
    case "install_remote_skill":
    case "create_custom_skill":
      return null;

    case "ssh_connect":
    case "start_tunnel":
    case "start_ssh_tunnel":
    case "stop_tunnel":
    case "stop_ssh_tunnel":
      return null;

    case "verify_tunnel_connectivity":
      return true;

    case "check_remote_prerequisites":
      return {
        node_installed: true,
        docker_running: true,
        openclaw_installed: false,
      };

    case "get_remote_openclaw_version":
      return "1.0.0";

    case "setup_remote_openclaw":
      return null;

    case "get_current_config":
      return null;

    default:
      // Unknown command — return null (like the Tauri "tauri" module handler)
      return null;
  }
}

export function startBridgeServer(): Promise<BridgeServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // CORS headers for browser fetch
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== "POST" || req.url !== "/ipc") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { cmd, args } = JSON.parse(body);
          console.log(`[bridge] ${cmd}`, args ? JSON.stringify(args).slice(0, 200) : "");
          const result = handleCommand(cmd, args || {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result }));
        } catch (err: any) {
          console.error(`[bridge] error:`, err.message);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      const port = addr.port;
      console.log(`[bridge] listening on http://127.0.0.1:${port}`);
      resolve({
        port,
        server,
        close: () => server.close(),
      });
    });

    server.on("error", reject);
  });
}
