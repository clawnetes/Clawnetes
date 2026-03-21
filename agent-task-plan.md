# Clawnetes Chat UI Cleanup

## Summary
- Hide non-user-facing system transcript entries in the chat workspace while preserving actionable error feedback.
- Convert the chat shell to grayscale-only light/dark themes without gradients or raised session controls.
- Compress the left session list into flat one-line rows and increase the default composer height.

## Implementation Changes
- Update `src/components/chat/ChatShell.tsx` so history normalization drops non-error `system` messages but still allows explicit failure messages added by the shell to render.
- Simplify the left-pane thread buttons to title-only single-line rows with truncation and existing active-state behavior.
- Refresh `src/App.css` to use only dark/light grey tokens, remove gradient fills, flatten button treatments, and enlarge the composer textarea.
- Extend chat-shell tests to cover system-message filtering, visible error handling, and the compact sidebar row behavior.
- Validate with `npm test` and `npm run tauri dev`.
- If validation succeeds, commit and push the changes.
