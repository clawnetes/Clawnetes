# Chat UI Polish — 6 Fixes

## Progress

- [x] Fix 1: Role labels — "You" / agent name / "System" instead of raw role
- [x] Fix 2: Filter out internal tool-call/tool-result messages
- [x] Fix 3: Inline send/stop icon in composer (replace separate buttons)
- [x] Fix 4: New Chat error handling
- [x] Fix 5: Agent dropdown in header instead of sidebar list
- [x] Fix 6: Version field serde mismatch ("undefined")

## Files Modified
- `src/components/chat/ChatShell.tsx`
- `src/App.css`
- `src-tauri/src/types.rs`
- `src/__tests__/chatShellMessages.test.tsx` (new — 10 tests)
