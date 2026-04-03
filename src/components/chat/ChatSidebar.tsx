import { useEffect, useRef, useState } from "react";
import type { ChatThemePreference, StoredChatThread } from "../../lib/chatShellStorage";
import type { StoredEnvironment } from "../../lib/environmentStorage";
import ChatIcon, { ChatActionButton } from "./ChatIcon";
import EmptyState from "../ui/EmptyState";
import ConfirmDialog from "../ui/ConfirmDialog";

export type { StoredEnvironment };

interface ChatSidebarProps {
  environments?: StoredEnvironment[];
  activeEnvironmentId?: string | null;
  onSwitchEnvironment?: (envId: string) => void;
  onAddEnvironment?: () => void;
  onRemoveEnvironment?: (envId: string) => void;
  canCreateChat: boolean;
  onNewChat: () => void;
  liveThreads: StoredChatThread[];
  archivedThreads: StoredChatThread[];
  activeThreadId: string;
  onThreadSwitch: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  themePreference: ChatThemePreference;
  onThemeChange: (theme: ChatThemePreference) => void;
  onOpenConfigure: () => void;
  onOpenPanel?: (view: string) => void;
  connectionLabel: string;
}

export default function ChatSidebar({
  environments,
  activeEnvironmentId,
  onSwitchEnvironment,
  onAddEnvironment,
  onRemoveEnvironment,
  canCreateChat,
  onNewChat,
  liveThreads,
  archivedThreads,
  activeThreadId,
  onThreadSwitch,
  onDeleteThread,
  themePreference,
  onThemeChange,
  onOpenConfigure,
  onOpenPanel,
  connectionLabel,
}: ChatSidebarProps) {
  const [envDropdownOpen, setEnvDropdownOpen] = useState(false);
  const [pendingRemoveEnvironment, setPendingRemoveEnvironment] = useState<StoredEnvironment | null>(null);
  const [pendingDeleteThread, setPendingDeleteThread] = useState<StoredChatThread | null>(null);
  const envDropdownRef = useRef<HTMLDivElement>(null);

  const handleCancelRemoveEnvironment = () => {
    setPendingRemoveEnvironment(null);
  };

  const handleConfirmRemoveEnvironment = () => {
    if (!pendingRemoveEnvironment || !onRemoveEnvironment) {
      return;
    }
    onRemoveEnvironment(pendingRemoveEnvironment.id);
    setPendingRemoveEnvironment(null);
  };

  const handleCancelDeleteThread = () => {
    setPendingDeleteThread(null);
  };

  const handleConfirmDeleteThread = () => {
    if (!pendingDeleteThread) {
      return;
    }
    onDeleteThread(pendingDeleteThread.id);
    setPendingDeleteThread(null);
  };

  useEffect(() => {
    if (!envDropdownOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (envDropdownRef.current && !envDropdownRef.current.contains(e.target as Node)) {
        setEnvDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [envDropdownOpen]);

  return (
    <aside className="chat-sidebar">
      <div className="chat-sidebar-top">
        {environments && environments.length >= 1 && onSwitchEnvironment && (
          <div className="chat-env-switcher">
            <p className="chat-sidebar-kicker">Environment</p>
            <div className="chat-env-dropdown" ref={envDropdownRef} data-testid="chat-env-dropdown">
              <button
                type="button"
                className="chat-env-trigger"
                onClick={() => setEnvDropdownOpen(!envDropdownOpen)}
              >
                <span>{environments.find((e) => e.id === activeEnvironmentId)?.name || "Select..."}</span>
                <svg className={`dropdown-chevron ${envDropdownOpen ? "rotated" : ""}`} width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {envDropdownOpen && (
                <div className="chat-env-panel">
                  {[...environments]
                    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                    .map((env) => {
                      const removable = Boolean(
                        onRemoveEnvironment && env.type === "cloud" && env.id !== activeEnvironmentId,
                      );

                      return (
                        <div
                          key={env.id}
                          className={`chat-env-row ${removable ? "removable" : ""}`}
                        >
                          <button
                            type="button"
                            className={`chat-env-option ${env.id === activeEnvironmentId ? "active" : ""}`}
                            onClick={() => {
                              if (env.id !== activeEnvironmentId) {
                                onSwitchEnvironment?.(env.id);
                              }
                              setEnvDropdownOpen(false);
                            }}
                          >
                            <span>{env.name}</span>
                            {env.id === activeEnvironmentId && (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                          {removable && (
                            <button
                              type="button"
                              className="chat-env-remove"
                              aria-label={`Remove saved remote ${env.name}`}
                              data-testid={`remove-environment-${env.id}`}
                              onClick={() => {
                                setPendingRemoveEnvironment(env);
                                setEnvDropdownOpen(false);
                              }}
                            >
                              <span aria-hidden="true">&times;</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  {onAddEnvironment && (
                    <>
                      <div className="chat-env-divider" />
                      <button
                        type="button"
                        className="chat-env-option add"
                        onClick={() => {
                          setEnvDropdownOpen(false);
                          onAddEnvironment();
                        }}
                      >
                        + Add remote environment
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="chat-sidebar-brand">
          <h1 data-testid="chat-sidebar-brand">Clawnetes</h1>
        </div>

        <button
          className="chat-primary-button"
          data-testid="chat-new-session"
          disabled={!canCreateChat}
          onClick={() => void onNewChat()}
        >
          <span className="chat-button-icon"><ChatIcon name="plus" /></span>
          <span className="chat-button-label">New chat</span>
        </button>
      </div>

      <div className="chat-sidebar-section">
        <div className="chat-sidebar-section-header">
          <span>Live</span>
        </div>
        <div className="chat-session-list">
          {liveThreads.length === 0 ? (
            <EmptyState
              icon={<svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v8H4l-2 2V3z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              title="No active chats"
              description="Start a conversation to see it here"
              className="py-4"
            />
          ) : (
            liveThreads.map((thread) => (
              <div
                key={thread.id}
                className={`chat-list-row ${activeThreadId === thread.id ? "active" : ""}`}
                data-testid={`chat-thread-row-${thread.id}`}
              >
                <button
                  className={`chat-list-item ${activeThreadId === thread.id ? "active" : ""}`}
                  onClick={() => void onThreadSwitch(thread.id)}
                  data-testid={`chat-thread-${thread.id}`}
                  type="button"
                >
                  <span className="chat-list-item-icon"><ChatIcon name="chat" /></span>
                  <strong title={thread.title}>{thread.title}</strong>
                </button>
                <button
                  type="button"
                  className="chat-list-delete"
                  data-testid={`delete-chat-thread-${thread.id}`}
                  aria-label={`Delete chat ${thread.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setPendingDeleteThread(thread);
                  }}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="chat-sidebar-section">
        <div className="chat-sidebar-section-header">
          <span>Recent</span>
        </div>
        <div className="chat-session-list">
          {archivedThreads.length === 0 ? (
            <EmptyState
              icon={<svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M3 3h10v2H3zM3 7h7v2H3zM3 11h10v2H3z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>}
              title="No past chats"
              description="Archived chats appear after /new"
              className="py-4"
            />
          ) : (
            archivedThreads.map((thread) => (
              <div
                key={thread.id}
                className={`chat-list-row ${activeThreadId === thread.id ? "active" : ""}`}
                data-testid={`chat-thread-row-${thread.id}`}
              >
                <button
                  className={`chat-list-item archived ${activeThreadId === thread.id ? "active" : ""}`}
                  onClick={() => void onThreadSwitch(thread.id)}
                  type="button"
                >
                  <span className="chat-list-item-icon"><ChatIcon name="note" /></span>
                  <strong title={thread.title}>{thread.title}</strong>
                </button>
                <button
                  type="button"
                  className="chat-list-delete"
                  data-testid={`delete-chat-thread-${thread.id}`}
                  aria-label={`Delete chat ${thread.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setPendingDeleteThread(thread);
                  }}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="chat-sidebar-actions">
        <div className="chat-theme-toggle" role="group" aria-label="Theme">
          {(["light", "dark", "system"] as ChatThemePreference[]).map((theme) => (
            <button
              key={theme}
              className={themePreference === theme ? "active" : ""}
              onClick={() => onThemeChange(theme)}
              type="button"
            >
              <span className="chat-button-icon">
                <ChatIcon name={theme === "light" ? "sun" : theme === "dark" ? "moon" : "system"} />
              </span>
              <span className="chat-button-label">{theme}</span>
            </button>
          ))}
        </div>
        <ChatActionButton
          className="secondary"
          data-testid="chat-configure"
          icon={<ChatIcon name="sliders" />}
          label="Settings"
          onClick={() => onOpenPanel?.("model")}
          type="button"
        />
        <div className="chat-sidebar-status">{connectionLabel}</div>
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteThread)}
        title={pendingDeleteThread?.status === "archived" ? "Delete archived chat" : "Delete live chat"}
        description={pendingDeleteThread?.status === "archived"
          ? `Delete "${pendingDeleteThread?.title}" from Clawnetes? This removes the archived transcript from local chat storage.`
          : `Delete "${pendingDeleteThread?.title}" from Clawnetes? This dismisses the live session locally and removes its saved transcript from this app.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmDeleteThread}
        onCancel={handleCancelDeleteThread}
      />
      <ConfirmDialog
        open={Boolean(pendingRemoveEnvironment)}
        title="Remove Remote Environment"
        description={pendingRemoveEnvironment
          ? `Remove saved remote "${pendingRemoveEnvironment.name}"? This only forgets the saved shortcut and will not change anything on the server.`
          : undefined}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmRemoveEnvironment}
        onCancel={handleCancelRemoveEnvironment}
      />
    </aside>
  );
}
