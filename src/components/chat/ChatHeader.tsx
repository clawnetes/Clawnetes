import { useState } from "react";
import type { GatewayChatAgent } from "../../lib/gatewayChat";
import { getBaseProviderFromModel } from "../../utils/providerAuth";
import Badge from "../ui/Badge";
import ProviderLogo from "../ui/ProviderLogo";
import ChatIcon, { ChatActionButton } from "./ChatIcon";
import AddAgentModal from "../panel/AddAgentModal";
import type { AgentConfigData } from "../../types";

interface ChatHeaderProps {
  agents: ({ id: string; name?: string; emoji?: string } | GatewayChatAgent)[];
  activeAgentId: string;
  activeAgentName: string;
  activeSessionKey: string;
  activeThreadIsArchived: boolean;
  gatewayConnected: boolean;
  chatReady: boolean;
  showEmptyAgentState: boolean;
  onAgentSwitch: (agentId: string) => void;
  onAddAgent?: (agent: AgentConfigData) => void | Promise<void>;
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
  onAddAgent,
  onResetChat,
  onRetryConnection,
  modelRef,
  fallbackCount,
  onOpenModelPanel,
}: ChatHeaderProps) {
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);
  const [isAddAgentModalOpen, setIsAddAgentModalOpen] = useState(false);
  const provider = modelRef ? getBaseProviderFromModel(modelRef) : "";
  const modelLabel = modelRef ? formatModelLabel(modelRef) : "";

  const handleAgentSelect = (agentId: string) => {
    if (agentId === "add-agent") {
      setIsAddAgentModalOpen(true);
    } else {
      onAgentSwitch(agentId);
    }
    setIsAgentDropdownOpen(false);
  };

  return (
    <header className="chat-main-header">
      <div className="chat-header-agent">
        <p className="chat-sidebar-kicker">Active Agent</p>
        <div className="flex items-center gap-2">
          {agents.length > 1 ? (
            <div className="relative">
              <button
                className="chat-agent-dropdown"
                data-testid="chat-active-agent"
                onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
                disabled={!gatewayConnected}
              >
                {activeAgentName || "Select agent..."}
              </button>
              {isAgentDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-md shadow-lg z-50 min-w-64">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 hover:bg-[var(--surface-active)] transition-colors ${
                        activeAgentId === agent.id ? "bg-[var(--accent)] text-white" : "text-[var(--text-main)]"
                      }`}
                      onClick={() => handleAgentSelect(agent.id)}
                    >
                      {("emoji" in agent && agent.emoji) || "🤖"} {agent.name || agent.id}
                    </button>
                  ))}
                  {onAddAgent && (
                    <>
                      <div className="border-t border-[var(--border)]" />
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-[var(--surface-active)] transition-colors text-[var(--text-main)]"
                        onClick={() => handleAgentSelect("add-agent")}
                      >
                        + Add Agent
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
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

      {/* Add Agent Modal */}
      {isAddAgentModalOpen && onAddAgent && (
        <AddAgentModal
          onClose={() => setIsAddAgentModalOpen(false)}
          onSubmit={(agent) => {
            void onAddAgent(agent);
            setIsAddAgentModalOpen(false);
          }}
        />
      )}
    </header>
  );
}
