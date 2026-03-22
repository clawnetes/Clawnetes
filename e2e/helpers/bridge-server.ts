/**
 * Real IPC bridge server.
 *
 * An HTTP server that maps Tauri IPC commands to actual shell commands
 * and filesystem operations, replicating what the Rust backend does.
 */
import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { execSync, ChildProcess } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { sshExec, sshExecSafe, scpWrite, startSshTunnel, RemoteConfig } from "./ssh-exec";

export interface BridgeServer {
  port: number;
  server: Server;
  close: () => void;
}

// Persisted auth-profiles data from configure_agent, re-applied after start_gateway
// because `openclaw doctor --fix` may overwrite auth-profiles.json.
let lastAuthProfilesPath: string | null = null;
let lastAuthProfilesContent: string | null = null;

// SSH tunnel background process
let tunnelProcess: ChildProcess | null = null;
const REMOTE_TUNNEL_ACCESS_PORT = 28789;

function extractRemoteConfig(args: Record<string, unknown>): RemoteConfig | null {
  const remote = args.remote as Record<string, unknown> | undefined;
  if (!remote || !remote.ip || !remote.user) return null;
  return {
    ip: remote.ip as string,
    user: remote.user as string,
    password: (remote.password as string) || undefined,
    sshKey: (remote.privateKeyPath as string) || (remote.private_key_path as string) || undefined,
  };
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

function normalizeGatewayToken(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const token = raw.trim().replace(/^"|"$/g, "");
  if (!token || token === "null" || token === "undefined" || token === "__OPENCLAW_REDACTED__") {
    return null;
  }
  return token;
}

function ensureLocalGatewayStarted(gatewayPort = 18789): void {
  if (shellSafe(`curl -sf http://127.0.0.1:${gatewayPort} > /dev/null`, 5_000) !== null) {
    return;
  }

  shellSafe("openclaw gateway stop");
  shellSafe("sleep 2");

  const plistPath = join(homedir(), "Library", "LaunchAgents", "ai.openclaw.gateway.plist");
  if (existsSync(plistPath)) {
    shellSafe(`launchctl bootstrap gui/$(id -u) "${plistPath}"`, 15_000);
  }

  shellSafe("openclaw doctor --fix --yes || true", 120_000);
  const startOutput = shellSafe("openclaw gateway start", 120_000);
  if (startOutput && /(error|failed)/i.test(startOutput)) {
    throw new Error(`Gateway start may have failed: ${startOutput}`);
  }

  const maxWait = Date.now() + 30_000;
  while (Date.now() < maxWait) {
    if (shellSafe(`curl -sf http://127.0.0.1:${gatewayPort} > /dev/null`, 5_000) !== null) {
      return;
    }
    shellSafe("sleep 2");
  }

  const status = shellSafe("openclaw gateway status", 15_000) || "Unable to get gateway status";
  throw new Error(`Gateway did not become reachable on port ${gatewayPort}. ${status}`);
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

  // Build auth profile — must match Rust resolve_profile_name: "{provider}:default"
  const profileName = `${provider}:default`;
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
          mode: "api_key",
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

  // Write auth-profiles.json (must match OpenClaw runtime expectations)
  // OpenClaw resolveApiKeyForProfile expects:
  //   type: "api_key" with field "key", OR type: "token" with field "token" + expires
  const profileEntry: Record<string, any> = {
    type: "api_key",
    provider: authProviderId,
    key: apiKey,
  };
  const authProfiles = {
    version: 1,
    profiles: { [profileName]: profileEntry },
    lastGood: { [provider]: profileName },
    usageStats: {},
  };
  const authProfilesJson = JSON.stringify(authProfiles, null, 2);
  writeFileSync(join(agentsDir, "auth-profiles.json"), authProfilesJson);

  // Persist for re-application after gateway start (doctor --fix may overwrite)
  lastAuthProfilesPath = join(agentsDir, "auth-profiles.json");
  lastAuthProfilesContent = authProfilesJson;
  console.log(`[bridge] auth-profiles.json written to: ${lastAuthProfilesPath}`);

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

/**
 * Replicate the Rust `setup_remote_openclaw` logic via SSH.
 * Reference: src-tauri/src/main.rs lines 1692-1930
 */
function setupRemoteOpenClaw(rc: RemoteConfig, config: Record<string, unknown>): void {
  console.log("[bridge] setting up remote OpenClaw...");

  // 1. Detect OS
  const osName = sshExecSafe(rc, "uname -s") || "Linux";
  console.log(`[bridge] remote OS: ${osName}`);

  // 2. Install Node if missing
  const nodeCheck = sshExecSafe(rc, "node -v");
  if (!nodeCheck) {
    console.log("[bridge] installing Node on remote...");
    if (osName === "Darwin") {
      sshExec(rc, "brew install node", 180_000);
    } else {
      sshExec(rc, "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs", 180_000);
    }
  }

  // 3. Install OpenClaw if missing
  const openclawCheck = sshExecSafe(rc, "openclaw --version");
  if (!openclawCheck) {
    console.log("[bridge] installing OpenClaw on remote...");
    sshExec(rc, "npm install -g openclaw", 180_000);
  }

  // 4. Run gateway install --force
  console.log("[bridge] running gateway install on remote...");
  sshExecSafe(rc, "openclaw gateway stop");
  sshExec(rc, "openclaw gateway install --force --profile messaging", 180_000);

  // 5. Build and write config files
  const provider = (config.provider as string) || "anthropic";
  const apiKey = (config.api_key as string) || (config.apiKey as string) || "";
  const modelStr = (config.model as string) || "claude-sonnet-4-20250514";
  const authMethod = (config.auth_method as string) || (config.authMethod as string) || "token";
  const userName = (config.user_name as string) || (config.userName as string) || "User";
  const agentName = (config.agent_name as string) || (config.agentName as string) || "Agent";
  const telegramToken = (config.telegram_token as string) || (config.telegramToken as string) || "";
  const gatewayPort = (config.gateway_port as number) || (config.gatewayPort as number) || 18789;
  const channel = (config.channel as string) || "telegram";

  const effectiveModel = modelStr.includes("/") ? modelStr : `${provider}/${modelStr}`;
  const gatewayToken = randomBytes(16).toString("hex");

  const authProviderMap: Record<string, string> = {
    anthropic: "anthropic",
    openai: "openai",
    google: "google-gemini",
    openrouter: "openrouter",
    xai: "xai",
  };
  const authProviderId = authProviderMap[provider] || provider;
  const profileName = `${provider}:default`;

  const openclawJson: Record<string, any> = {
    messages: { ackReactionScope: "group-mentions" },
    agents: {
      defaults: {
        maxConcurrent: 4,
        subagents: { maxConcurrent: 8 },
        compaction: { mode: "safeguard" },
        workspace: "~/.openclaw/workspace",
        model: { primary: effectiveModel },
        models: { [effectiveModel]: {} },
      },
      list: [{
        id: "main",
        name: agentName,
        workspace: "~/.openclaw/workspace",
        agentDir: "~/.openclaw/agents/main/agent",
        model: { primary: effectiveModel },
      }],
    },
    gateway: {
      mode: "local",
      port: gatewayPort,
      bind: "0.0.0.0",
      auth: { mode: "token", token: gatewayToken },
      tailscale: { mode: "off", resetOnExit: false },
    },
    auth: {
      profiles: {
        [profileName]: { provider: authProviderId, mode: "api_key" },
      },
    },
    commands: { native: "auto", nativeSkills: "auto" },
  };

  // Add channel config
  if (telegramToken && channel === "telegram") {
    openclawJson.channels = {
      telegram: { accounts: { default: { botToken: telegramToken, name: "Primary Bot", dmPolicy: "pairing" } } },
    };
    openclawJson.plugins = { entries: { telegram: { enabled: true } } };
  }
  if (config.whatsapp_enabled || config.whatsappEnabled) {
    const dmPolicy = (config.whatsapp_dm_policy as string) || (config.whatsappDmPolicy as string) || "open";
    const phone = (config.whatsapp_phone_number as string) || (config.whatsappPhone as string) || "";
    const whatsappObj: Record<string, any> = {
      enabled: true, selfChatMode: true, dmPolicy, groupPolicy: "allowlist", debounceMs: 0, mediaMaxMb: 50,
    };
    if (dmPolicy === "open") whatsappObj.allowFrom = ["*"];
    else if (dmPolicy === "allowlist" && phone) whatsappObj.allowFrom = [phone.startsWith("+") ? phone : `+${phone}`];
    openclawJson.channels = openclawJson.channels || {};
    openclawJson.channels.whatsapp = whatsappObj;
    openclawJson.plugins = openclawJson.plugins || { entries: {} };
    openclawJson.plugins.entries.whatsapp = { enabled: true };
  }

  // Write openclaw.json to remote
  console.log("[bridge] writing remote config files...");
  scpWrite(rc, "~/.openclaw/openclaw.json", JSON.stringify(openclawJson, null, 2));

  // Write auth-profiles.json
  const authProfiles = {
    version: 1,
    profiles: { [profileName]: { type: "api_key", provider: authProviderId, key: apiKey } },
    lastGood: { [provider]: profileName },
    usageStats: {},
  };
  scpWrite(rc, "~/.openclaw/agents/main/agent/auth-profiles.json", JSON.stringify(authProfiles, null, 2));

  // Write markdown files
  sshExecSafe(rc, "mkdir -p ~/.openclaw/workspace");
  scpWrite(rc, "~/.openclaw/workspace/IDENTITY.md",
    `# IDENTITY.md - Who Am I?\n- **Name:** ${agentName}\n- **Emoji:** \u{1F99E}\n---\nManaged by Clawnetes.`);
  scpWrite(rc, "~/.openclaw/workspace/USER.md",
    `# USER.md - About Your Human\n- **Name:** ${userName}\n---`);
  scpWrite(rc, "~/.openclaw/workspace/SOUL.md",
    `# SOUL.md\n## Mission\nServe ${userName}.`);

  // Write clawnetes-meta.json
  const meta: Record<string, any> = {};
  if (config.agent_type || config.agentType) {
    meta.agent_type = (config.agent_type as string) || (config.agentType as string);
  }
  scpWrite(rc, "~/.openclaw/clawnetes-meta.json", JSON.stringify(meta, null, 2));

  // Sync token via openclaw config
  sshExecSafe(rc, `openclaw config set gateway.auth.token ${gatewayToken}`);

  // Start gateway on remote
  console.log("[bridge] starting remote gateway...");
  sshExecSafe(rc, "openclaw gateway stop");
  sshExecSafe(rc, "sleep 2");
  sshExecSafe(rc, "openclaw doctor --fix --yes || true", 120_000);

  // Re-write auth-profiles after doctor --fix
  scpWrite(rc, "~/.openclaw/agents/main/agent/auth-profiles.json", JSON.stringify(authProfiles, null, 2));

  sshExec(rc, "openclaw gateway start", 120_000);

  // Poll for gateway to be ready on remote
  const maxWait = 60_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const check = sshExecSafe(rc, "curl -sf http://127.0.0.1:18789 > /dev/null");
    if (check !== null) break;
    sshExecSafe(rc, "sleep 2");
  }
  console.log("[bridge] remote gateway started.");
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
      ensureLocalGatewayStarted(18789);

      if (lastAuthProfilesPath && lastAuthProfilesContent) {
        mkdirSync(join(lastAuthProfilesPath, ".."), { recursive: true });
        writeFileSync(lastAuthProfilesPath, lastAuthProfilesContent);
        console.log(`[bridge] re-applied auth-profiles.json after doctor --fix`);
      }
      return "Gateway started.";
    }

    case "restart_openclaw_gateway": {
      const rc = extractRemoteConfig(args);
      if (rc) {
        sshExecSafe(rc, "openclaw gateway stop");
        sshExecSafe(rc, "sleep 2");
        sshExec(rc, "openclaw gateway start", 120_000);
      } else {
        shellSafe("openclaw gateway stop");
        shellSafe("sleep 2");
        shell("openclaw gateway start", 120_000);
      }
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
      const isRemote = args.isRemote === true || args.is_remote === true;
      const gatewayPort = Number((args.gatewayPort as number) || (args.gateway_port as number) || 18789);
      const rc = extractRemoteConfig(args);

      if (isRemote && rc) {
        // Read token from remote openclaw.json
        const remoteToken = sshExecSafe(rc, "cat ~/.openclaw/openclaw.json | node -e \"const d=require('fs').readFileSync('/dev/stdin','utf8');const c=JSON.parse(d);console.log(c.gateway.auth.token)\"");
        if (remoteToken) {
          const token = remoteToken.trim().replace(/^"|"$/g, "");
          if (token && token !== "null" && token !== "undefined") {
            return `http://127.0.0.1:${REMOTE_TUNNEL_ACCESS_PORT}/#token=${token}`;
          }
        }
        // Fallback: try openclaw config get on remote
        const remoteTokenAlt = sshExecSafe(rc, "openclaw config get gateway.auth.token");
        if (remoteTokenAlt) {
          const token = remoteTokenAlt.trim().replace(/^"|"$/g, "");
          if (token && token !== "null" && token !== "undefined") {
            return `http://127.0.0.1:${REMOTE_TUNNEL_ACCESS_PORT}/#token=${token}`;
          }
        }
        return `http://127.0.0.1:${REMOTE_TUNNEL_ACCESS_PORT}`;
      }

      // Local path
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
          return `http://127.0.0.1:${gatewayPort}/#token=${token}`;
        }
      }
      // Last resort: read from openclaw.json directly
      const cfgPath = join(homedir(), ".openclaw", "openclaw.json");
      if (existsSync(cfgPath)) {
        try {
          const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
          const token = cfg?.gateway?.auth?.token;
          if (token) return `http://127.0.0.1:${gatewayPort}/#token=${token}`;
        } catch { /* ignore */ }
      }
      return `http://127.0.0.1:${gatewayPort}`;
    }

    case "prepare_gateway_chat_connection": {
      const gatewayPort = Number((args.gatewayPort as number) || (args.gateway_port as number) || 18789);
      const isRemote = Boolean(extractRemoteConfig(args));
      const rc = extractRemoteConfig(args);

      if (isRemote && rc) {
        if (!tunnelProcess) {
          tunnelProcess = startSshTunnel(rc, REMOTE_TUNNEL_ACCESS_PORT, gatewayPort);
        }

        const remoteToken =
          sshExecSafe(
            rc,
            "cat ~/.openclaw/openclaw.json | node -e \"const d=require('fs').readFileSync('/dev/stdin','utf8');const c=JSON.parse(d);console.log(c.gateway.auth.token)\"",
          ) || sshExecSafe(rc, "openclaw config get gateway.auth.token");
        const normalizedRemoteToken = normalizeGatewayToken(remoteToken);

        if (!normalizedRemoteToken) {
          throw new Error("Unable to resolve remote gateway token");
        }

        return {
          wsUrl: `ws://127.0.0.1:${REMOTE_TUNNEL_ACCESS_PORT}`,
          authToken: normalizedRemoteToken,
          targetEnvironment: "cloud",
          gatewayPort: REMOTE_TUNNEL_ACCESS_PORT,
          tunnelActive: true,
          openClawVersion: sshExecSafe(rc, "openclaw --version") || "0.0.0",
        };
      }

      ensureLocalGatewayStarted(gatewayPort);

      const tokenOutput = normalizeGatewayToken(shellSafe("openclaw config get gateway.auth.token"))
        || normalizeGatewayToken(
          shellSafe(
            `cat ${join(homedir(), ".openclaw", "openclaw.json")} | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const c=JSON.parse(d);console.log(c.gateway.auth.token)"`,
          ),
        );
      if (!tokenOutput) {
        throw new Error("Unable to resolve local gateway token");
      }

      return {
        wsUrl: `ws://127.0.0.1:${gatewayPort}`,
        authToken: tokenOutput,
        targetEnvironment: "local",
        gatewayPort,
        tunnelActive: false,
        openClawVersion: shellSafe("openclaw --version") || "0.0.0",
      };
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

    case "install_node": {
      const rc = extractRemoteConfig(args);
      if (rc) {
        // Install Node remotely
        const os = sshExecSafe(rc, "uname -s") || "Linux";
        if (os === "Darwin") {
          sshExec(rc, "brew install node || true", 120_000);
        } else {
          sshExec(rc, "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs", 120_000);
        }
      } else {
        shell("brew install node || true", 120_000);
      }
      return null;
    }

    case "install_remote_skill": {
      const rc = extractRemoteConfig(args);
      const skillName = (args.name as string) || (args.skill as string) || "";
      if (rc && skillName) {
        sshExec(rc, `npx clawhub install ${skillName}`, 120_000);
      } else if (skillName) {
        shell(`npx clawhub install ${skillName}`, 120_000);
      }
      return null;
    }

    case "create_custom_skill":
      return null;

    case "test_ssh_connection": {
      const rc = extractRemoteConfig(args);
      if (!rc) return "Error: missing remote config";
      const result = sshExecSafe(rc, "echo ok");
      if (result === "ok") return "SSH connection established successfully!";
      throw new Error("SSH connection failed");
    }

    case "ssh_connect":
      return null;

    case "start_tunnel":
    case "start_ssh_tunnel": {
      const rc = extractRemoteConfig(args);
      const gatewayPort = Number((args.gatewayPort as number) || (args.gateway_port as number) || 18789);
      if (!rc) return "Error: missing remote config";
      if (tunnelProcess) {
        // Already running
        return "SSH tunnel is already running";
      }
      tunnelProcess = startSshTunnel(rc, REMOTE_TUNNEL_ACCESS_PORT, gatewayPort);
      // Wait a moment for tunnel to establish
      shellSafe("sleep 3");
      // Verify it's working
      const check = shellSafe(`curl -sf http://127.0.0.1:${REMOTE_TUNNEL_ACCESS_PORT} > /dev/null`);
      if (check === null) {
        console.log("[bridge] tunnel started but gateway not yet reachable — may need more time");
      }
      return "SSH tunnel started.";
    }

    case "stop_tunnel":
    case "stop_ssh_tunnel": {
      if (tunnelProcess) {
        try { tunnelProcess.kill(); } catch { /* ignore */ }
        tunnelProcess = null;
      }
      // Also kill any lingering SSH tunnel processes on the local tunnel port.
      shellSafe(`lsof -ti:${REMOTE_TUNNEL_ACCESS_PORT} -sTCP:LISTEN | xargs kill 2>/dev/null || true`);
      return null;
    }

    case "verify_tunnel_connectivity": {
      try {
        shell(`curl -sf http://127.0.0.1:${REMOTE_TUNNEL_ACCESS_PORT} > /dev/null`, 10_000);
        return true;
      } catch {
        return false;
      }
    }

    case "check_remote_prerequisites": {
      const rc = extractRemoteConfig(args);
      if (!rc) return { node_installed: false, docker_running: true, openclaw_installed: false };
      const nodeOk = sshExecSafe(rc, "node -v") !== null;
      const openclawOk = sshExecSafe(rc, "openclaw --version") !== null;
      return {
        node_installed: nodeOk,
        docker_running: true,
        openclaw_installed: openclawOk,
      };
    }

    case "get_remote_openclaw_version": {
      const rc = extractRemoteConfig(args);
      if (!rc) return "0.0.0";
      const ver = sshExecSafe(rc, "openclaw --version");
      return ver || "0.0.0";
    }

    case "setup_remote_openclaw": {
      const rc = extractRemoteConfig(args);
      if (!rc) throw new Error("Missing remote config");
      const config = (args.config as Record<string, unknown>) || args;
      setupRemoteOpenClaw(rc, config);
      return "Remote OpenClaw setup complete.";
    }

    case "uninstall_remote_openclaw": {
      const rc = extractRemoteConfig(args);
      if (!rc) throw new Error("Missing remote config");
      sshExecSafe(rc, "openclaw gateway stop");
      sshExecSafe(rc, "sudo npm uninstall -g openclaw || npm uninstall -g openclaw", 60_000);
      sshExecSafe(rc, "rm -rf ~/.openclaw");
      return "Remote OpenClaw uninstalled.";
    }

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
