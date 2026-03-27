# ChatShell Decomposition Plan

## Goal
Decompose ChatShell.tsx (1362 lines) into 6 focused sub-components.

## New Files
1. `src/components/chat/ChatMarkdown.tsx` - Markdown rendering (renderInlineMarkdown, renderMarkdownParagraph, renderChatMarkdown, ChatMessageBody)
2. `src/components/chat/ChatIcon.tsx` - ChatIcon + ChatActionButton
3. `src/components/chat/ChatSidebar.tsx` - Sidebar JSX (env switcher, brand, new chat, thread lists, theme, configure)
4. `src/components/chat/ChatHeader.tsx` - Main panel header (agent dropdown, session meta, reset/reconnect)
5. `src/components/chat/ChatTranscript.tsx` - Transcript area (state cards, message list)
6. `src/components/chat/ChatComposer.tsx` - Composer (textarea, send/stop, status)

## Existing File Changes
- `ChatShell.tsx` - Remove extracted code, import new components, become orchestrator
- `chatMessageFilters.ts` - Export StoredEnvironment interface (moved from ChatShell)

## Progress
- [x] Read and analyze current ChatShell.tsx
- [x] Create ChatMarkdown.tsx
- [x] Create ChatIcon.tsx
- [x] Create ChatSidebar.tsx
- [x] Create ChatHeader.tsx
- [x] Create ChatTranscript.tsx
- [x] Create ChatComposer.tsx
- [x] Update ChatShell.tsx (orchestrator)
- [x] Move StoredEnvironment to shared location
- [x] Run npx tsc --noEmit (clean, exit 0)
- [x] Run npm run build (tsc + vite build, clean)
- [x] Run npm test (276 tests pass, 29 files)
- [x] No compilation errors

## Result
- ChatShell.tsx: 1362 -> 806 lines (orchestrator with state/effects/handlers)
- ChatMarkdown.tsx: 169 lines
- ChatIcon.tsx: 116 lines
- ChatSidebar.tsx: 208 lines
- ChatHeader.tsx: 77 lines
- ChatTranscript.tsx: 105 lines
- ChatComposer.tsx: 77 lines
- StoredEnvironment: re-exported from existing lib/environmentStorage.ts (no duplication)
