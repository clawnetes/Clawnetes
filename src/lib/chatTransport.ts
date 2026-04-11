import type {
  GatewayAgentEventPayload,
  GatewayChatAgent,
  GatewayChatEventPayload,
  GatewayChatHistoryPayload,
  GatewayChatSession,
  GatewayConnectState,
  GatewaySessionsChangedPayload,
} from "./gatewayChat";
import { GatewayChatClient } from "./gatewayChat";
import { HermesChatTransport } from "./hermesChatTransport";
import type { GatewayChatBootstrap } from "../types";

export interface ChatTransportClient {
  onStateChange?: (state: GatewayConnectState) => void;
  onHealth?: (ok: boolean) => void;
  onChatEvent?: (payload: GatewayChatEventPayload) => void;
  onAgentEvent?: (payload: GatewayAgentEventPayload) => void;
  onSessionsChanged?: (payload: GatewaySessionsChangedPayload) => void;
  onSeqGap?: () => void;
  onReady?: (payload?: unknown) => void;
  connect(): Promise<void>;
  disconnect(): void;
  listAgents(): Promise<{ defaultId?: string; agents: GatewayChatAgent[] }>;
  listSessions(agentId?: string): Promise<{ sessions: GatewayChatSession[] }>;
  loadHistory(sessionKey: string): Promise<GatewayChatHistoryPayload>;
  sendChat(sessionKey: string, message: string, thinking?: string): Promise<{ runId: string }>;
  abortChat(sessionKey: string, runId: string): Promise<unknown>;
  resetSession(sessionKey: string): Promise<unknown>;
}

export function createChatTransportClient(bootstrap: GatewayChatBootstrap): ChatTransportClient {
  if (bootstrap.chatTransport === "hermes-api") {
    return new HermesChatTransport(bootstrap);
  }
  return new GatewayChatClient(bootstrap);
}
