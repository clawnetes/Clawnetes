import { invoke } from "../lib/tauri";
import { REMOTE_TUNNEL_ACCESS_PORT } from "../lib/gatewayPorts";

import { getAgentSessionInitIds } from "./agentSessions";
import { getAdvancedTransitionAction } from "./licenseGate";
import {
  getMessagingChannelFromConfig,
  hasMessagingSettingsChanged,
  isMessagingLinked,
  shouldShowTelegramPairing,
} from "./messagingPairing";
import { constructConfigPayload, type ConfigPayloadInput } from "./configPayload";
import {
  getBaseProvider,
  normalizeModelRefForUi,
  normalizeProviderAuths,
} from "./providerAuth";
import { toUiSandboxMode } from "./sandboxMode";
import {
  normalizeSkillAndToolSelection,
} from "./toolSelection";
import type { AgentConfigData, ProviderAuthConfig, RemoteConfig, ToolPolicy } from "../types";
import type { WizardState } from "../hooks/useWizardState";

type Setter<T> = (value: T | ((prev: T) => T)) => void;

export interface AdvancedTransitionController {
  step: number;
  licenseStatusLoaded: boolean;
  licenseUnlocked: boolean;
  licenseStatusError: string;
  setMode: Setter<string>;
  setPairingStatus: Setter<string>;
  setSkipBasicConfig: Setter<boolean>;
  setMaintCompleted: Setter<boolean>;
  setStep: Setter<number>;
  setLicenseError: Setter<string>;
  setShowLicenseModal: Setter<boolean>;
  initialConfigRef: React.MutableRefObject<any>;
}

export async function continueToAdvancedSettings(
  controller: AdvancedTransitionController,
) {
  controller.setMode("advanced");
  controller.setPairingStatus("");
  controller.setSkipBasicConfig(true);
  controller.setMaintCompleted(true);

  if (controller.step === 17 && !controller.initialConfigRef.current) {
    try {
      controller.initialConfigRef.current = await invoke("get_current_config", { remote: null });
    } catch (error) {
      console.warn("Could not load config baseline for change detection:", error);
    }
  }

  controller.setStep(10.5);
}

export async function handleAdvancedTransition(
  controller: AdvancedTransitionController,
) {
  const nextAction = getAdvancedTransitionAction(
    controller.licenseStatusLoaded,
    controller.licenseUnlocked,
  );
  if (nextAction === "wait") {
    return;
  }

  if (nextAction === "prompt") {
    controller.setLicenseError(controller.licenseStatusError);
    controller.setShowLicenseModal(true);
    return;
  }

  await continueToAdvancedSettings(controller);
}

function buildRemoteConfig(state: Pick<
  WizardState,
  "targetEnvironment" | "remoteIp" | "remoteUser" | "remotePassword" | "remotePrivateKeyPath"
>): RemoteConfig | null {
  if (state.targetEnvironment !== "cloud") {
    return null;
  }

  return {
    ip: state.remoteIp,
    user: state.remoteUser,
    password: state.remotePassword || null,
    privateKeyPath: state.remotePrivateKeyPath || null,
  };
}

function getCurrentMessagingSettings(state: Pick<
  WizardState,
  "messagingChannel" | "telegramToken" | "whatsappDmPolicy" | "whatsappPhoneNumber"
>) {
  return {
    channel: state.messagingChannel,
    telegramToken: state.telegramToken,
    whatsappDmPolicy: state.whatsappDmPolicy,
    whatsappPhoneNumber: state.whatsappPhoneNumber,
  };
}

function getInitialMessagingSettings(initial: any) {
  return {
    channel: getMessagingChannelFromConfig(initial || {}),
    telegramToken: initial?.telegram_token || "",
    whatsappDmPolicy: initial?.whatsapp_dm_policy || null,
    whatsappPhoneNumber: initial?.whatsapp_phone_number || "",
  };
}

export interface InstallController {
  state: Pick<
    WizardState,
    | "targetEnvironment"
    | "remoteIp"
    | "remoteUser"
    | "remotePassword"
    | "remotePrivateKeyPath"
    | "checks"
    | "isPaired"
    | "whatsappPaired"
    | "messagingChannel"
    | "telegramToken"
    | "whatsappDmPolicy"
    | "whatsappPhoneNumber"
    | "gatewayPort"
    | "selectedSkills"
  >;
  configPayloadInput: ConfigPayloadInput;
  initialConfigRef: React.MutableRefObject<any>;
  transformInitialToPayload: (initial: any) => any;
  normalizeForComparison: (payload: any) => any;
  isDeepEqual: (left: any, right: any) => boolean;
  setLoading: Setter<boolean>;
  setError: Setter<boolean>;
  setProgress: Setter<string>;
  setLogs: Setter<string>;
  setIsPaired: Setter<boolean>;
  setWhatsappPaired: Setter<boolean>;
  setWhatsappPhoneSubmitted: Setter<boolean>;
  setOpenClawVersion: Setter<string>;
  setChecks: Setter<WizardState["checks"]>;
  setTunnelActive: Setter<boolean>;
  setPairingCode: Setter<string>;
  setDashboardUrl: Setter<string>;
  setStep: Setter<number>;
}

export async function handleInstall(controller: InstallController) {
  const { state } = controller;

  controller.setLoading(true);
  controller.setError(false);

  const isUpdate = !!controller.initialConfigRef.current;
  controller.setProgress(isUpdate ? "Applying changes..." : "Starting setup...");

  const remoteConfig = buildRemoteConfig(state);

  let actualIsPaired = state.isPaired;
  let actualWhatsappPaired = state.whatsappPaired;
  const currentMessagingSettings = getCurrentMessagingSettings(state);
  const initialMessagingSettings = controller.initialConfigRef.current
    ? getInitialMessagingSettings(controller.initialConfigRef.current)
    : null;
  const messagingSettingsChanged = initialMessagingSettings
    ? hasMessagingSettingsChanged(initialMessagingSettings, currentMessagingSettings)
    : true;

  if (state.checks.openclaw || isUpdate) {
    try {
      if (state.messagingChannel !== "none") {
        const status: boolean = await invoke("check_messaging_link_status", {
          channel: state.messagingChannel,
          remote: remoteConfig,
        });
        if (state.messagingChannel === "telegram") {
          actualIsPaired = status;
          controller.setIsPaired(status);
        } else if (state.messagingChannel === "whatsapp") {
          actualWhatsappPaired = status;
          controller.setWhatsappPaired(status);
          if (status) {
            controller.setWhatsappPhoneSubmitted(true);
          }
        }
      }
    } catch (error) {
      console.warn("Pre-install pairing check failed:", error);
    }
  }

  const configPayload = constructConfigPayload(controller.configPayloadInput);
  const agentSessionIds = getAgentSessionInitIds(configPayload.agents);
  const effectiveMessagingLinked = isMessagingLinked(state.messagingChannel, {
    telegramPaired: actualIsPaired,
    whatsappPaired: actualWhatsappPaired,
  });
  configPayload.preserve_state = initialMessagingSettings && !messagingSettingsChanged
    ? true
    : effectiveMessagingLinked;

  if (controller.initialConfigRef.current) {
    const initialPayload = controller.transformInitialToPayload(controller.initialConfigRef.current);
    if (
      controller.isDeepEqual(
        controller.normalizeForComparison(initialPayload),
        controller.normalizeForComparison(configPayload),
      )
    ) {
      controller.setProgress("Configuration unchanged.");
      setTimeout(() => {
        controller.setLoading(false);
        controller.setStep(17);
      }, 500);
      return;
    }
  }

  try {
    if (state.targetEnvironment === "cloud") {
      controller.setProgress(isUpdate ? "Updating remote configuration..." : "Deploying to remote server...");
      controller.setLogs(isUpdate ? "Updating remote configuration..." : "Preparing remote environment...");

      await invoke("setup_remote_openclaw", {
        remote: remoteConfig,
        config: configPayload,
      });

      for (const skill of state.selectedSkills) {
        controller.setProgress(`Installing skill on remote: ${skill}...`);
        controller.setLogs(`Installing skill: ${skill}...`);
        try {
          await invoke("install_remote_skill", {
            remote: remoteConfig,
            name: skill,
          });
        } catch (error) {
          console.error(`Failed to install skill ${skill}:`, error);
          controller.setLogs((prev) => `${prev}\nWarning: Failed to install skill ${skill}: ${error}`);
        }
      }

      controller.setProgress("Establishing SSH tunnel...");
      controller.setLogs("Creating SSH tunnel to remote gateway...");
      try {
        await invoke("start_ssh_tunnel", {
          gatewayPort: state.gatewayPort,
          remote: remoteConfig,
        });
      } catch (error) {
        if (String(error).includes("SSH tunnel is already running")) {
          controller.setLogs((prev) => `${prev}\nTunnel already active.`);
        } else {
          throw error;
        }
      }
      controller.setTunnelActive(true);

      controller.setProgress("Verifying tunnel connectivity...");
      try {
        const tunnelWorking: boolean = await invoke("verify_tunnel_connectivity", {
          gatewayPort: state.gatewayPort,
          remote: remoteConfig,
        });
        if (!tunnelWorking) {
          throw new Error("Backend update pending. Please restart the application (Ctrl+C and npm run tauri dev) to apply the latest fixes.");
        }
      } catch (error) {
        const errStr = String(error);
        controller.setProgress("");
        controller.setLogs(
          errStr.includes("Backend update pending")
            ? `Error: ${errStr}`
            : `Error: Tunnel verification failed - ${errStr}`,
        );
        controller.setError(true);
        controller.setTunnelActive(false);
        controller.setLoading(false);
        return;
      }

      controller.setProgress("Finalizing setup...");
      if (shouldShowTelegramPairing(state.messagingChannel, actualIsPaired)) {
        const instruction: string = await invoke("generate_pairing_code");
        controller.setPairingCode(instruction);
      }

      const url: string = await invoke("get_dashboard_url", {
        gatewayPort: state.gatewayPort,
        isRemote: true,
        remote: remoteConfig,
      });
      controller.setDashboardUrl(url);
      controller.setProgress("");
      controller.setStep(17);
    } else {
      if (!state.checks.openclaw) {
        controller.setProgress("Installing OpenClaw (this may take a minute)...");
        controller.setLogs("Installing OpenClaw (this may take a minute)...");
        await invoke("install_openclaw");
        const version: string = await invoke("get_openclaw_version");
        controller.setOpenClawVersion(version);
        controller.setChecks((prev) => ({ ...prev, openclaw: true }));
      }

      controller.setProgress("Configuring agent...");
      controller.setLogs("Configuring...");
      await invoke("configure_agent", {
        config: configPayload,
      });

      for (const skill of state.selectedSkills) {
        controller.setProgress(`Installing skill: ${skill}...`);
        controller.setLogs(`Installing skill: ${skill}...`);
        try {
          await invoke("install_skill", { name: skill });
        } catch (error) {
          console.error(`Failed to install skill ${skill}:`, error);
          controller.setLogs((prev) => `${prev}\nWarning: Failed to install skill ${skill}: ${error}`);
        }
      }

      if (isUpdate || state.messagingChannel === "whatsapp") {
        controller.setProgress("Restarting Gateway (this may take 20-30 seconds)...");
        controller.setLogs("Restarting Gateway...");
        await invoke("restart_openclaw_gateway", { remote: null });
      } else {
        controller.setProgress("Starting Gateway (this may take 20-30 seconds)...");
        controller.setLogs("Starting Gateway...");
        await invoke("start_gateway");
      }

      if (agentSessionIds.length > 0) {
        controller.setProgress("Initializing agent sessions...");
        controller.setLogs("Initializing agent sessions...");
        try {
          await invoke("initialize_agent_sessions", { agentIds: agentSessionIds });
        } catch (error) {
          console.warn("Agent session init failed (non-fatal):", error);
        }
      }

      controller.setProgress("Finalizing setup...");
      if (shouldShowTelegramPairing(state.messagingChannel, actualIsPaired)) {
        const instruction: string = await invoke("generate_pairing_code");
        controller.setPairingCode(instruction);
      }

      const url: string = await invoke("get_dashboard_url", {
        isRemote: false,
        remote: null,
      });
      controller.setDashboardUrl(url);
      controller.setProgress("");
      controller.setStep(17);
    }
  } catch (error) {
    controller.setProgress("");
    controller.setLogs(`Error: ${error}`);
    controller.setError(true);
  }

  controller.setLoading(false);
}

export interface MaintenanceController {
  state: Pick<
    WizardState,
    | "targetEnvironment"
    | "sshStatus"
    | "remoteIp"
    | "remoteUser"
    | "remotePassword"
    | "remotePrivateKeyPath"
    | "gatewayPort"
  >;
  setLoading: Setter<boolean>;
  setMaintenanceStatus: Setter<string>;
  setLogs: Setter<string>;
  setChecks: Setter<WizardState["checks"]>;
  setMaintCompleted: Setter<boolean>;
}

export async function handleMaintenanceAction(
  controller: MaintenanceController,
  action: string,
) {
  controller.setLoading(true);
  controller.setMaintenanceStatus(`Running ${action}...`);
  controller.setLogs(`Starting maintenance: ${action}...\n`);

  try {
    let response: string;
    const remoteConfig = controller.state.targetEnvironment === "cloud" && controller.state.sshStatus === "success"
      ? buildRemoteConfig(controller.state)
      : null;

    if (action === "repair") {
      response = remoteConfig
        ? await invoke("run_remote_doctor_repair", { remote: remoteConfig })
        : await invoke("run_doctor_repair");
      controller.setMaintenanceStatus("✅ Repair completed successfully.");
    } else if (action === "audit") {
      response = remoteConfig
        ? await invoke("run_remote_security_audit_fix", { remote: remoteConfig })
        : await invoke("run_security_audit_fix");
      controller.setMaintenanceStatus("✅ Security Audit completed successfully.");
    } else if (action === "update") {
      response = remoteConfig
        ? await invoke("update_remote_openclaw", { remote: remoteConfig })
        : await invoke("install_openclaw");
      controller.setMaintenanceStatus(
        remoteConfig ? "✅ Remote OpenClaw updated." : "✅ OpenClaw updated.",
      );
    } else {
      response = remoteConfig
        ? await invoke("uninstall_remote_openclaw", { remote: remoteConfig })
        : await invoke("uninstall_openclaw");
      controller.setChecks((prev) => ({ ...prev, openclaw: false }));
      controller.setMaintenanceStatus("✅ Uninstall completed successfully.");
    }

    controller.setLogs((prev) => `${prev}${response || ""}`);
    controller.setMaintCompleted(true);
    controller.setLoading(false);
    return true;
  } catch (error) {
    controller.setLogs((prev) => `${prev}\nError: ${error}`);
    controller.setMaintenanceStatus(`❌ ${action} failed.`);
    controller.setLoading(false);
    return false;
  }
}

export interface ConfigLoaderController {
  state: Pick<
    WizardState,
    | "targetEnvironment"
    | "remoteIp"
    | "remoteUser"
    | "remotePassword"
    | "remotePrivateKeyPath"
  >;
  initialConfigRef: React.MutableRefObject<any>;
  availableSkillIds: Set<string>;
  getLoadedTopLevelToolPolicy: (config: any) => ToolPolicy;
  getLoadedAgentToolPolicy: (agent: any) => ToolPolicy;
  setLoading: Setter<boolean>;
  setMaintenanceStatus: Setter<string>;
  setMode: Setter<string>;
  setProvider: Setter<string>;
  setApiKey: Setter<string>;
  setAuthMethod: Setter<string>;
  setProviderAuths: Setter<Record<string, ProviderAuthConfig>>;
  setModel: Setter<string>;
  setUserName: Setter<string>;
  setAgentName: Setter<string>;
  setAgentEmoji: Setter<string>;
  setAgentType: Setter<WizardState["agentType"]>;
  setTelegramToken: Setter<string>;
  setGatewayPort: Setter<number>;
  setGatewayBind: Setter<string>;
  setGatewayAuthMode: Setter<string>;
  setTailscaleMode: Setter<string>;
  setNodeManager: Setter<string>;
  setSelectedSkills: Setter<string[]>;
  setServiceKeys: Setter<Record<string, string>>;
  setSandboxMode: Setter<string>;
  setToolPolicy: Setter<ToolPolicy>;
  setFallbackModels: Setter<string[]>;
  setEnableFallbacks: Setter<boolean>;
  setHeartbeatMode: Setter<string>;
  setIdleTimeoutMs: Setter<number>;
  setIdentityMd: Setter<string>;
  setUserMd: Setter<string>;
  setSoulMd: Setter<string>;
  setInitialWorkspace: Setter<WizardState["initialWorkspace"]>;
  setToolsMd: Setter<string>;
  setAgentsMd: Setter<string>;
  setHeartbeatMd: Setter<string>;
  setMemoryMd: Setter<string>;
  setMemoryEnabled: Setter<boolean>;
  setCronJobs: Setter<WizardState["cronJobs"]>;
  setMessagingChannel: Setter<WizardState["messagingChannel"]>;
  setWhatsappPaired: Setter<boolean>;
  setWhatsappPhoneSubmitted: Setter<boolean>;
  setWhatsappPhoneNumber: Setter<string>;
  setWhatsappDmPolicy: Setter<string>;
  setThinkingLevel: Setter<string>;
  setLmstudioBaseUrl: Setter<string>;
  setLocalBaseUrl: Setter<string>;
  setEnableMultiAgent: Setter<boolean>;
  setNumAgents: Setter<number>;
  setAgentConfigs: Setter<AgentConfigData[]>;
  setIsPaired: Setter<boolean>;
}

export async function loadExistingConfig(controller: ConfigLoaderController): Promise<boolean> {
  controller.setLoading(true);
  controller.setMaintenanceStatus("Loading existing configuration...");

  try {
    const remoteConfig = buildRemoteConfig(controller.state);
    const config: any = await invoke("get_current_config", { remote: remoteConfig });
    controller.initialConfigRef.current = config;

    const normalizedProvider = getBaseProvider(config.provider);
    const normalizedProviderAuths = normalizeProviderAuths(
      config.provider_auths,
      normalizedProvider,
      config.api_key || "",
      config.auth_method || "token",
    );

    controller.setProvider(normalizedProvider);
    controller.setApiKey(normalizedProviderAuths[normalizedProvider]?.token || config.api_key);
    controller.setAuthMethod(normalizedProviderAuths[normalizedProvider]?.auth_method || config.auth_method);
    controller.setProviderAuths(normalizedProviderAuths);
    controller.setModel(normalizeModelRefForUi(config.model, normalizedProviderAuths));
    controller.setUserName(config.user_name);
    controller.setAgentName(config.agent_name);
    controller.setAgentEmoji(config.agent_emoji || "🦞");
    controller.setAgentType(config.agent_type || "custom");
    controller.setTelegramToken(config.telegram_token);
    controller.setGatewayPort(config.gateway_port);
    controller.setGatewayBind(config.gateway_bind);
    controller.setGatewayAuthMode(config.gateway_auth_mode);
    controller.setTailscaleMode(config.tailscale_mode);
    controller.setNodeManager(config.node_manager);

    const normalizedTopLevelSelection = normalizeSkillAndToolSelection(
      config.skills,
      config.allowed_tools,
      controller.availableSkillIds,
    );
    controller.setSelectedSkills(normalizedTopLevelSelection.skills);
    controller.setServiceKeys(config.service_keys);
    controller.setSandboxMode(toUiSandboxMode(config.sandbox_mode));
    controller.setToolPolicy(controller.getLoadedTopLevelToolPolicy(config));
    controller.setFallbackModels(
      config.fallback_models.map((modelRef: string) => normalizeModelRefForUi(modelRef, normalizedProviderAuths)),
    );
    controller.setEnableFallbacks(config.fallback_models.length > 0);
    controller.setHeartbeatMode(config.heartbeat_mode);
    controller.setIdleTimeoutMs(config.idle_timeout_ms);
    controller.setIdentityMd(config.identity_md);
    controller.setUserMd(config.user_md);
    controller.setSoulMd(config.soul_md);
    controller.setInitialWorkspace({
      identity: config.identity_md,
      user: config.user_md,
      soul: config.soul_md,
    });

    if (config.tools_md) controller.setToolsMd(config.tools_md);
    if (config.agents_md) controller.setAgentsMd(config.agents_md);
    if (config.heartbeat_md) controller.setHeartbeatMd(config.heartbeat_md);
    if (config.memory_md) controller.setMemoryMd(config.memory_md);
    if (config.memory_enabled !== undefined) controller.setMemoryEnabled(config.memory_enabled);
    if (config.cron_jobs) controller.setCronJobs(config.cron_jobs);

    const loadedMessagingChannel = getMessagingChannelFromConfig(config);
    controller.setMessagingChannel(loadedMessagingChannel);
    if (loadedMessagingChannel === "whatsapp") {
      controller.setWhatsappPaired(true);
      controller.setWhatsappPhoneSubmitted(true);
    } else if (loadedMessagingChannel === "none") {
      controller.setWhatsappPaired(false);
      controller.setWhatsappPhoneSubmitted(false);
    }
    if (config.whatsapp_phone_number) controller.setWhatsappPhoneNumber(config.whatsapp_phone_number);
    if (config.whatsapp_dm_policy) controller.setWhatsappDmPolicy(config.whatsapp_dm_policy);
    if (config.thinking_level) controller.setThinkingLevel(config.thinking_level);
    if (config.local_base_url) {
      if (config.provider === "lmstudio") controller.setLmstudioBaseUrl(config.local_base_url);
      else if (config.provider === "local") controller.setLocalBaseUrl(config.local_base_url);
    }

    controller.setEnableMultiAgent(config.enable_multi_agent);
    if (config.enable_multi_agent && config.agent_configs) {
      controller.setNumAgents(config.agent_configs.length);
      controller.setAgentConfigs(
        config.agent_configs.map((agent: any) => {
          const normalizedAgentSelection = normalizeSkillAndToolSelection(
            agent.skills,
            agent.tools?.allow || agent.allowed_tools,
            controller.availableSkillIds,
          );

          return {
            id: agent.id,
            name: agent.name,
            model: normalizeModelRefForUi(agent.model, normalizedProviderAuths),
            fallbackModels: (agent.fallback_models || []).map((modelRef: string) =>
              normalizeModelRefForUi(modelRef, normalizedProviderAuths),
            ),
            skills: normalizedAgentSelection.skills,
            vibe: agent.vibe,
            emoji: agent.emoji || "🦞",
            identityMd: agent.identity_md || "",
            userMd: agent.user_md || "",
            soulMd: agent.soul_md || "",
            toolsMd: agent.tools_md || "",
            agentsMd: agent.agents_md || "",
            toolPolicy: controller.getLoadedAgentToolPolicy(agent),
            cronJobs: agent.cron_jobs || [],
          };
        }),
      );
    }

    if (config.is_paired !== undefined) {
      controller.setIsPaired(config.is_paired);
    }

    try {
      if (loadedMessagingChannel !== "none") {
        const linked: boolean = await invoke("check_messaging_link_status", {
          channel: loadedMessagingChannel,
          remote: remoteConfig,
        });
        if (loadedMessagingChannel === "telegram") {
          controller.setIsPaired(linked);
        } else if (loadedMessagingChannel === "whatsapp") {
          controller.setWhatsappPaired(linked);
          controller.setWhatsappPhoneSubmitted(linked || Boolean(config.whatsapp_phone_number));
        }
      }
    } catch (error) {
      console.warn("Failed to refresh messaging link state:", error);
    }

    controller.setMaintenanceStatus("✅ Configuration loaded.");
    controller.setMode("advanced");
    return true;
  } catch (error) {
    console.error("Failed to load config:", error);
    controller.setMaintenanceStatus(`❌ Failed to load config: ${error}`);
    return false;
  } finally {
    controller.setLoading(false);
  }
}

export interface TunnelController {
  state: Pick<
    WizardState,
    | "tunnelActive"
    | "remoteIp"
    | "remoteUser"
    | "remotePassword"
    | "remotePrivateKeyPath"
    | "gatewayPort"
  >;
  setLoading: Setter<boolean>;
  setTunnelActive: Setter<boolean>;
  setMaintenanceStatus: Setter<string>;
}

export async function handleToggleTunnel(controller: TunnelController) {
  controller.setLoading(true);
  if (controller.state.tunnelActive) {
    try {
      await invoke("stop_ssh_tunnel");
      controller.setTunnelActive(false);
      controller.setMaintenanceStatus("✅ SSH Tunnel disconnected.");
    } catch (error) {
      controller.setMaintenanceStatus(`❌ Failed to stop tunnel: ${error}`);
    }
  } else {
    controller.setMaintenanceStatus("Establishing SSH tunnel...");
    try {
      await invoke("start_ssh_tunnel", {
        gatewayPort: controller.state.gatewayPort,
        remote: {
          ip: controller.state.remoteIp,
          user: controller.state.remoteUser,
          password: controller.state.remotePassword || null,
          privateKeyPath: controller.state.remotePrivateKeyPath || null,
        },
      });
      controller.setTunnelActive(true);
      controller.setMaintenanceStatus(`✅ SSH Tunnel established on localhost:${REMOTE_TUNNEL_ACCESS_PORT}.`);
    } catch (error) {
      controller.setMaintenanceStatus(`❌ Failed to establish tunnel: ${error}`);
    }
  }
  controller.setLoading(false);
}
