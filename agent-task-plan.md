# Route Chat To The Selected Sub-Agent

## Summary
- Fix chat routing so selecting a sub-agent uses that agent’s own session for history and sends.
- Prevent the chat shell from falling back to the main/global session when switching agents.
- Add a regression that proves sub-agent replies come from the selected agent, not `main`.

## Implementation Changes
- Update `src/components/chat/ChatShell.tsx` to resolve session keys per-agent only.
- Stop carrying `activeSessionKeyRef.current` across agent switches when selecting the next thread/session.
- Create/load a draft thread for a sub-agent with no prior session instead of inheriting the main transcript.
- Add routing coverage in `src/__tests__/chatShellRouting.test.tsx`.

## Validation
- Run targeted chat routing tests.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if validation succeeds.
