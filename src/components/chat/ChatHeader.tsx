import type { GatewayChatAgent } from "../../lib/gatewayChat";
import { getBaseProviderFromModel } from "../../utils/providerAuth";
import Badge from "../ui/Badge";
import ProviderLogo from "../ui/ProviderLogo";
import ChatIcon, { ChatActionButton } from "./ChatIcon";

interface ChatHeaderProps {
  agents: GatewayChatAgent[];
  activeAgentId: string;
  activeAgentName: string;
  activeSessionKey: string;
  activeThreadIsArchived: boolean;
  gatewayConnected: boolean;
  chatReady: boolean;
  showEmptyAgentState: boolean;
  onAgentSwitch: (agentId: string) => void;
  onResetChat: () => void;
  onRetryConnection: () => void;
  modelRef?: string;
  fallbackCount?: number;
  onOpenModelPanel?: () => void;
}

function formatModelLabel(modelRef: string): string {
  if (!modelRef) return "";
  const parts = modelRef.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : modelRef;
}

export default function ChatHeader({
  agents,
  activeAgentId,
  activeAgentName,
  activeSessionKey,
  activeThreadIsArchived,
  gatewayConnected,
  chatReady,
  showEmptyAgentState,
  onAgentSwitch,
  onResetChat,
  onRetryConnection,
  modelRef,
  fallbackCount,
  onOpenModelPanel,
}: ChatHeaderProps) {
  const provider = modelRef ? getBaseProviderFromModel(modelRef) : "";
  const modelLabel = modelRef ? formatModelLabel(modelRef) : "";

  return (
    <header className="chat-main-header">
      <div className="chat-header-agent">
        <p className="chat-sidebar-kicker">Active Agent</p>
        <div className="flex items-center gap-2">
          {agents.length > 1 ? (
            <select
              className="chat-agent-dropdown"
              data-testid="chat-active-agent"
              value={activeAgentId}
              onChange={(e) => void onAgentSwitch(e.target.value)}
              disabled={!gatewayConnected}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
              ))}
            </select>
          ) : (
            <h2 data-testid="chat-active-agent">
              {showEmptyAgentState ? "No agents available" : activeAgentName || "Connecting to gateway..."}
            </h2>
          )}

          {modelRef && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--surface-hover)] hover:bg-[var(--surface-active)] text-[var(--text-subtle)] text-[0.65rem] font-medium transition-colors cursor-pointer border-0"
              onClick={onOpenModelPanel}
              title={`Model: ${modelRef}`}
              data-testid="chat-model-badge"
            >
              {provider && <ProviderLogo provider={provider} size={12} />}
              <span>{modelLabel}</span>
              {typeof fallbackCount === "number" && fallbackCount > 0 && (
                <Badge variant="neutral" className="ml-0.5 text-[0.55rem]">
                  +{fallbackCount}
                </Badge>
              )}
            </button>
          )}
        </div>
        <span className="chat-header-thread-meta">
          {activeThreadIsArchived ? "Archived transcript" : `Session ${activeSessionKey || "main"}`}
        </span>
      </div>
      <div className="chat-main-actions">
        <ChatActionButton
          className="secondary"
          data-testid="chat-reset"
          disabled={!chatReady || !activeSessionKey || activeThreadIsArchived}
          icon={<ChatIcon name="reset" />}
          label="Reset"
          onClick={() => void onResetChat()}
          type="button"
        />
        <ChatActionButton
          className="secondary"
          data-testid="chat-reconnect"
          icon={<ChatIcon name="reconnect" />}
          label="Reconnect"
          onClick={onRetryConnection}
          type="button"
        />
      </div>
    </header>
  );
}
