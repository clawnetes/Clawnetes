import { TEXT_ENTRY_PROPS } from "../ui/textEntryProps";

interface ChatComposerProps {
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  canSend: boolean;
  chatReady: boolean;
  activeAgentId: string;
  activeAgentName: string;
  activeThreadIsArchived: boolean;
  sending: boolean;
  activeRunId: string;
}

export default function ChatComposer({
  composerValue,
  onComposerChange,
  onSend,
  onAbort,
  canSend,
  chatReady,
  activeAgentId,
  activeAgentName,
  activeThreadIsArchived,
  sending,
  activeRunId,
}: ChatComposerProps) {
  return (
    <div className="chat-composer">
      <div className="chat-composer-input-wrap">
        <textarea
          {...TEXT_ENTRY_PROPS}
          value={composerValue}
          onChange={(event) => onComposerChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void onSend();
            }
          }}
          placeholder={
            activeThreadIsArchived
              ? "Archived chats are read-only"
              : `Message ${activeAgentName || "agent"} (Enter to send)`
          }
          rows={1}
          data-testid="chat-composer"
          disabled={!chatReady || !activeAgentId || activeThreadIsArchived}
        />
        {sending ? (
          <button
            className="chat-composer-icon-btn stop"
            onClick={() => void onAbort()}
            disabled={!activeRunId || !chatReady}
            aria-label="Stop"
            data-testid="chat-stop"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
          </button>
        ) : (
          <button
            className="chat-composer-icon-btn send"
            data-testid="chat-send"
            disabled={!canSend}
            onClick={() => void onSend()}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="12" x2="8" y2="4" /><polyline points="4,7 8,3 12,7" /></svg>
          </button>
        )}
      </div>
      <span className="chat-composer-status">
        {sending
          ? "Agent is thinking..."
          : activeThreadIsArchived
            ? "Read-only archived transcript"
            : "Enter sends, Shift+Enter adds a new line"}
      </span>
    </div>
  );
}
