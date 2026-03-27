import type { ChatMessage } from "../../lib/chatMessageFilters";
import ChatIcon, { ChatActionButton } from "./ChatIcon";
import ChatMessageBody from "./ChatMarkdown";

interface ChatTranscriptProps {
  transcriptRef: React.RefObject<HTMLDivElement | null>;
  transcriptEndRef: React.RefObject<HTMLDivElement | null>;
  showConnectingState: boolean;
  isConfigUpdating?: boolean;
  connectionLabel: string;
  shellError: string;
  showEmptyAgentState: boolean;
  loadingHistory: boolean;
  messages: ChatMessage[];
  activeAgentName: string;
  activeThreadIsArchived: boolean;
  activeThreadTitle?: string;
  activeSessionKey: string;
  onSetComposerValue: (value: string) => void;
}

export default function ChatTranscript({
  transcriptRef,
  transcriptEndRef,
  showConnectingState,
  isConfigUpdating = false,
  connectionLabel,
  shellError,
  showEmptyAgentState,
  loadingHistory,
  messages,
  activeAgentName,
  activeThreadIsArchived,
  activeThreadTitle,
  activeSessionKey,
  onSetComposerValue,
}: ChatTranscriptProps) {
  return (
    <div className="chat-transcript">
      <div ref={transcriptRef} className="chat-transcript-scroll">
        {isConfigUpdating && (
          <div className="chat-config-banner" data-testid="chat-config-banner">
            Applying changes...
          </div>
        )}

        {showConnectingState ? (
          <div className="chat-state-card" data-testid="chat-connecting-state">
            <h3>Connecting to OpenClaw</h3>
            <p>{connectionLabel}</p>
          </div>
        ) : shellError ? (
          <div className="chat-state-card error" data-testid="chat-error-state">
            <h3>Gateway connection failed</h3>
            <p>{shellError}</p>
          </div>
        ) : showEmptyAgentState ? (
          <div className="chat-state-card" data-testid="chat-empty-agent-state">
            <h3>No agents available</h3>
            <p>The OpenClaw gateway is connected, but it did not return any configured agents.</p>
          </div>
        ) : loadingHistory ? (
          <div className="chat-state-card">
            <h3>Loading session</h3>
            <p>Fetching the latest transcript from OpenClaw.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty-stage">
            <div className="chat-empty-stage-badge">Workspace</div>
            <h3>{activeThreadIsArchived ? activeThreadTitle || "Archived chat" : "Let's build"}</h3>
            <p>
              {activeThreadIsArchived
                ? "This transcript is archived locally. Switch to a live chat or start a new one to keep sending."
                : `${activeAgentName || "Your agent"} is ready on ${activeSessionKey || "main"}.`}
            </p>
            {!activeThreadIsArchived && (
              <div className="chat-suggestion-grid">
                <ChatActionButton
                  icon={<ChatIcon name="spark" />}
                  label="Build a release checklist"
                  onClick={() => onSetComposerValue("Build a release checklist for this repo.")}
                  type="button"
                />
                <ChatActionButton
                  icon={<ChatIcon name="note" />}
                  label="Summarize this workspace"
                  onClick={() => onSetComposerValue("Summarize the current OpenClaw chat architecture.")}
                  type="button"
                />
                <ChatActionButton
                  icon={<ChatIcon name="plan" />}
                  label="Create a plan"
                  onClick={() => onSetComposerValue("Draft an implementation plan for the next bugfix.")}
                  type="button"
                />
              </div>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`chat-bubble ${message.role} ${message.error ? "error" : ""}`}
            >
              <span className="chat-bubble-role">
                {message.role === "user" ? "You" : message.role === "assistant" ? activeAgentName : "System"}
              </span>
              <ChatMessageBody message={message} />
            </article>
          ))
        )}
        <div ref={transcriptEndRef} className="chat-transcript-end" aria-hidden="true" />
      </div>
    </div>
  );
}
