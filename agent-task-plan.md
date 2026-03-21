# Fix Chat Message Markdown Rendering

## Summary
- Render assistant replies as formatted markdown instead of showing raw markdown syntax in chat bubbles.
- Support common assistant output patterns such as emphasis, lists, inline code, fenced code blocks, and links.
- Keep the existing transcript-noise filtering intact while improving the visible presentation layer.

## Implementation Changes
- Update `src/components/chat/ChatShell.tsx` with a lightweight markdown renderer for chat message content.
- Render assistant and system replies with structured markup while keeping user messages as plain text.
- Add markdown-specific bubble styles in `src/App.css` for paragraphs, lists, links, inline code, and fenced code blocks.
- Extend `src/__tests__/chatShellMessages.test.tsx` with regressions that verify structured markdown rendering.

## Validation
- Run targeted chat message tests.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if validation succeeds.
