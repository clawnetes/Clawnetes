# Chat Output Formatting Fix

## Goal
Fix the chat transcript so it hides internal agent reasoning/process output, renders assistant markdown correctly, and makes links clickable for both local and remote sessions.

## Files In Scope
- `package.json`
- `package-lock.json`
- `src/lib/chatMessageFilters.ts`
- `src/components/chat/ChatShell.tsx`
- `src/components/chat/ChatMarkdown.tsx`
- `src/App.css`
- `src/lib/__tests__/chatMessageFilters.test.ts`
- `src/components/__tests__/chatComponents.test.tsx`
- `src/__tests__/chatShellMessages.test.tsx`

## Checklist
- [x] Create plan/progress file
- [x] Add shared assistant-output sanitization for history and live streams
- [x] Update live stream assembly to sanitize visible text from raw assistant deltas
- [x] Replace custom markdown renderer with standards-based rendering and clickable links
- [x] Update chat markdown styling
- [x] Add tests for hidden reasoning/process noise and markdown rendering
- [x] Run targeted tests
- [x] Run full `npm test`
- [x] Run `npm run tauri dev`
- [x] Fix stale sending/stop state after replies complete through session refresh
- [x] Expand transcript sanitization for skill docs, browser payload JSON, and multi-section assistant traces
- [x] Add regression tests for the newly reported leaks
- [x] Re-run targeted tests, full `npm test`, and `npm run tauri dev`
- [x] Strip messaging gateway/system wrappers from transcript history messages
- [x] Add regressions for WhatsApp-style `YOU` / `System:` / timestamp-wrapped message leaks
- [x] Re-run targeted tests, full `npm test`, and `npm run tauri dev` after messaging-wrapper fix

## Progress Notes
- Confirmed the current leak has two causes: history sanitization is incomplete, and live assistant stream text is merged raw before display.
- Confirmed the current markdown renderer is a narrow custom parser, which explains raw asterisks and inconsistent link handling.
- Added `react-markdown` and `remark-gfm`, plus external-link handling through the Tauri opener so markdown links and bare URLs render as real anchors.
- Added shared assistant transcript sanitization with `<final>` extraction, open-final streaming support, structured transcript section stripping, and retained existing tool/bootstrap noise filtering.
- Updated `ChatShell` so assistant messages keep `rawText` for stream assembly while rendering only sanitized visible text; empty final assistant bubbles are now suppressed.
- Targeted chat tests and the full `npm test` suite both pass.
- `npm run tauri dev` initially failed because Vite port `1420` was already occupied by an existing repo-local Vite process. Validation succeeded by reusing that server with:
  `npm run tauri dev -- --config '{"build":{"beforeDevCommand":"true"}}' --no-dev-server-wait --no-watch`
- Follow-up issue confirmed: some sessions appear to complete via persisted history or `sessions.changed` refresh without a matching `chat.state === "final"` event reaching the UI, which leaves `sending` and `activeRunId` stuck.
- Follow-up sanitizer gap confirmed: the leaked sample includes skill frontmatter using `allowed-tools:` plus browser page payload JSON (`targetId`, `wsUrl`, `type: "page"`), which the current noise filters do not classify as internal output.
- Updated the assistant sanitization to treat multi-speaker transcript blocks as structured traces even when they do not include `think` or `<final>`, skip `YOU` tool sections, filter meta/planning chatter, and keep the visible assistant answer sections.
- Expanded noise classification to hide skill frontmatter that uses `allowed-tools:` and browser automation page payload JSON that includes `targetId`, `url`, `wsUrl`, and `type: "page"`.
- Updated `loadHistory()` to clear `sending` and `activeRunId` when refreshed persisted history for the active session ends in an assistant reply, which fixes the stuck stop button / “Agent is thinking...” state when completion is observed through session refresh instead of a `chat.final` event.
- Added regressions for the leaked transcript shape and for runs that complete through `sessions.changed` history refresh without a final chat event.
- Re-ran targeted tests, full `npm test`, and `npm run tauri dev -- --config '{"build":{"beforeDevCommand":"true"}}' --no-dev-server-wait --no-watch`; all passed, again reusing the repo-local Vite server already listening on port `1420`.
- Latest follow-up issue confirmed: some channel-backed history messages are still rendered with wrapper lines like `YOU`, `System: [timestamp] WhatsApp gateway connected.`, and `[Wed ...] actual message`, so user-message sanitization still needs a messaging-specific cleanup pass.
- Added messaging-wrapper cleanup for non-assistant transcript history so gateway status lines are dropped and channel timestamp prefixes are stripped, leaving only the actual user-visible message body.
- Added unit and chat-shell regressions for the exact WhatsApp-shaped sample: `YOU`, `System: [timestamp] WhatsApp gateway connected.`, and `[Wed ...] hey ...`.
- Re-ran targeted tests, full `npm test`, and `npm run tauri dev -- --config '{"build":{"beforeDevCommand":"true"}}' --no-dev-server-wait --no-watch`; all passed after the messaging-wrapper fix.
