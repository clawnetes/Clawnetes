import { createContext, useContext } from "react";

export type PanelView = "model" | "skills" | "identity" | "tools" | "advanced";

interface ChatPanelContextValue {
  panelOpen: boolean;
  panelView: PanelView;
  setPanelOpen: (open: boolean) => void;
  setPanelView: (view: PanelView) => void;
  openPanel: (view?: PanelView) => void;
  closePanel: () => void;
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

export function useChatPanel() {
  const ctx = useContext(ChatPanelContext);
  if (!ctx) throw new Error("useChatPanel must be used within ChatPanelProvider");
  return ctx;
}

export default ChatPanelContext;
