# Chat Shell Polish Pass 2

## Summary
- Refine dark mode to use layered charcoal greys instead of near-black surfaces.
- Restyle the chat-shell controls with compact icon+text treatments similar to the reference image.
- Hide internal startup/bootstrap transcript noise in fresh chats and stabilize scroll behavior so replies no longer make the UI jump.

## Implementation Changes
- Update `src/components/chat/ChatShell.tsx` with message-visibility helpers that suppress startup instructions, bootstrap file dumps, and JSON `read` `ENOENT` payloads while preserving real assistant/user messages and actionable shell errors.
- Restyle chat controls in the sidebar, header, empty state, and composer to use flat icon+text actions while keeping the current chat-only scope.
- Refresh `src/App.css` dark theme surfaces toward charcoal grey, reduce heavy contrast, and tune transcript/composer layout to avoid jumpy reply behavior.
- Extend `src/__tests__/chatShellMessages.test.tsx` with regression coverage for hidden bootstrap noise, preserved visible errors, and the updated control behavior.
- Validate with `npm test` and `npm run tauri dev`.
- If validation succeeds, commit and push the changes.
