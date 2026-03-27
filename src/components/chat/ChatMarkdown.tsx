import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { ChatMessage } from "../../lib/chatMessageFilters";
import { openExternal } from "../../lib/tauri";

function shouldOpenExternally(href: string) {
  return /^(?:https?:\/\/|mailto:)/i.test(href);
}

const markdownComponents: Components = {
  a({ href, children, ...props }) {
    const target = typeof href === "string" ? href : "";

    return (
      <a
        {...props}
        href={target || undefined}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => {
          if (!target || !shouldOpenExternally(target)) return;
          event.preventDefault();
          void openExternal(target);
        }}
      >
        {children}
      </a>
    );
  },
  pre({ children, ...props }) {
    return (
      <pre {...props} className="chat-markdown-code-block">
        {children}
      </pre>
    );
  },
};

export default function ChatMessageBody({ message }: { message: ChatMessage }) {
  const text = message.text || (message.pending ? "Thinking..." : "");

  if (message.role === "assistant" || message.role === "system") {
    return (
      <div className="chat-message-markdown">
        <ReactMarkdown
          components={markdownComponents}
          remarkPlugins={[remarkGfm]}
          skipHtml={true}
        >
          {text}
        </ReactMarkdown>
      </div>
    );
  }

  return <p className="chat-message-plain">{text}</p>;
}
