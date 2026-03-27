import { useCallback, useEffect, useRef, useState } from "react";
import type { GatewayChatAgent } from "../../lib/gatewayChat";
import { getBaseProviderFromModel } from "../../utils/providerAuth";
import Badge from "../ui/Badge";
import ConfirmDialog from "../ui/ConfirmDialog";
import ProviderLogo from "../ui/ProviderLogo";
import ChatIcon, { ChatActionButton } from "./ChatIcon";
import AddAgentModal from "../panel/AddAgentModal";
import type { AgentConfigData, ProviderAuthConfig } from "../../types";

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
  onRemoveAgent?: (agentId: string) => void | Promise<void>;
  providerAuths?: Record<string, ProviderAuthConfig>;
  onProviderAuthChange?: (provider: string, auth: ProviderAuthConfig) => void | Promise<void>;
  onStartOAuth?: (provider: string, authMethod: string, oauthProviderId: string) => Promise<ProviderAuthConfig>;
  onDetectLocalModels?: (provider: "ollama" | "lmstudio" | "local", baseUrl?: string) => Promise<string[]>;
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
  onRemoveAgent,
  providerAuths,
  onProviderAuthChange,
  onStartOAuth,
  onDetectLocalModels,
  onResetChat,
  onRetryConnection,
  modelRef,
  fallbackCount,
  onOpenModelPanel,
}: ChatHeaderProps) {
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);
  const [isAddAgentModalOpen, setIsAddAgentModalOpen] = useState(false);
  const [pendingRemoveAgentId, setPendingRemoveAgentId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const provider = modelRef ? getBaseProviderFromModel(modelRef) : "";
  const modelLabel = modelRef ? formatModelLabel(modelRef) : "";

  const activeAgent = agents.find((a) => a.id === activeAgentId);
  const activeEmoji = (activeAgent && "emoji" in activeAgent && activeAgent.emoji) || "🤖";

  // Show dropdown when there are multiple agents, or a single agent with + Add Agent available
  const showDropdown = agents.length >= 1 && (agents.length > 1 || !!onAddAgent);

  const closeDropdown = useCallback(() => setIsAgentDropdownOpen(false), []);

  // Click-outside close
  useEffect(() => {
    if (!isAgentDropdownOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isAgentDropdownOpen, closeDropdown]);

  // Escape close
  useEffect(() => {
    if (!isAgentDropdownOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDropdown();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isAgentDropdownOpen, closeDropdown]);

  const handleAgentSelect = (agentId: string) => {
    if (agentId === "add-agent") {
      setIsAddAgentModalOpen(true);
    } else {
      onAgentSwitch(agentId);
    }
    setIsAgentDropdownOpen(false);
  };

  const handleRemoveAgentClick = () => {
    setPendingRemoveAgentId(activeAgentId);
    setIsAgentDropdownOpen(false);
  };

  const handleCancelRemoveAgent = useCallback(() => {
    setPendingRemoveAgentId(null);
  }, []);

  const handleConfirmRemoveAgent = useCallback(() => {
    if (!pendingRemoveAgentId || !onRemoveAgent) return;
    void onRemoveAgent(pendingRemoveAgentId);
    setPendingRemoveAgentId(null);
  }, [onRemoveAgent, pendingRemoveAgentId]);

  return (
    <>
      <header className="chat-main-header">
        <div className="chat-header-agent">
          <p className="chat-sidebar-kicker">Active Agent</p>
          <div className="flex items-center gap-2">
            {showDropdown ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  className="chat-agent-dropdown"
                  data-testid="chat-active-agent"
                  onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
                  disabled={!gatewayConnected}
                  aria-haspopup="listbox"
                  aria-expanded={isAgentDropdownOpen}
                >
                  {activeEmoji} {activeAgentName || "Select agent..."}
                </button>
                {isAgentDropdownOpen && (
                  <div
                    className="chat-agent-dropdown-menu"
                    role="listbox"
                    data-testid="agent-dropdown-menu"
                  >
                    {agents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        role="option"
                        aria-selected={activeAgentId === agent.id}
                        className={`chat-agent-option${activeAgentId === agent.id ? " active" : ""}`}
                        onClick={() => handleAgentSelect(agent.id)}
                      >
                        {("emoji" in agent && agent.emoji) || "🤖"} {agent.name || agent.id}
                      </button>
                    ))}
                    {onAddAgent && (
                      <>
                        <div className="chat-agent-divider" />
                        <button
                          type="button"
                          className="chat-agent-option add"
                          data-testid="add-agent-option"
                          onClick={() => handleAgentSelect("add-agent")}
                        >
                          + Add Agent
                        </button>
                      </>
                    )}
                    {onRemoveAgent && activeAgentId !== "main" && (
                      <>
                        <div className="chat-agent-divider" />
                        <button
                          type="button"
                          className="chat-agent-option remove"
                          data-testid="remove-agent-option"
                          onClick={handleRemoveAgentClick}
                        >
                          Remove Agent
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

        {isAddAgentModalOpen && onAddAgent && (
          <AddAgentModal
            onClose={() => setIsAddAgentModalOpen(false)}
            onSubmit={onAddAgent}
            providerAuths={providerAuths}
            onProviderAuthChange={onProviderAuthChange}
            onStartOAuth={onStartOAuth}
            onDetectLocalModels={onDetectLocalModels}
          />
        )}
      </header>
      <ConfirmDialog
        open={Boolean(pendingRemoveAgentId)}
        title="Remove Agent"
        description={`Remove agent "${activeAgentName}"? This will also delete it from the saved OpenClaw configuration.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmRemoveAgent}
        onCancel={handleCancelRemoveAgent}
      />
    </>
  );
}
