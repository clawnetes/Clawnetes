# Hide Remaining Internal Chat Transcript Noise

## Summary
- Remove raw tool JSON, wrapped external fetch content, and test-label prefixes from the chat workspace transcript.
- Keep only the user prompt and the final assistant-facing reply visible.
- Add regressions for the leaked political-search transcript patterns.

## Implementation Changes
- Extend `src/components/chat/ChatShell.tsx` transcript sanitization for JSON tool payloads and `EXTERNAL_UNTRUSTED_CONTENT` wrappers.
- Strip standalone `TEST`/`YOU` noise labels when they prefix an otherwise valid reply.
- Add focused chat-shell tests for leaked web-search/web-fetch transcript content.

## Validation
- Run targeted chat-shell tests.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if validation succeeds.
