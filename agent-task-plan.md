# Hide Internal Command Center Transcript Noise

## Summary
- Stop the chat workspace from rendering internal skill/tool transcript content after returning from Command Center.
- Keep only the actual conversational reply visible in loaded history.
- Add regression tests for the leaked weather-skill and terminal-output patterns.

## Implementation Changes
- Extend `src/components/chat/ChatShell.tsx` transcript sanitization with high-confidence filters for internal skill frontmatter, terminal ANSI output, and wttr/weather tool dumps.
- Keep the existing tool/system/bootstrap filtering in place.
- Add chat history tests for leaked internal content and a Command Center round-trip regression.

## Validation
- Run targeted chat-shell tests.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if all checks pass.
