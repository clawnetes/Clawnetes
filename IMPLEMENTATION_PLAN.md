# Command Center and Chat Shell Fix Plan

## Scope
- Clear Clawnetes-local chat cache after uninstall.
- Replace the chat overlay Command Center with a full-window screen.
- Fix rounded button consistency, thread alignment, and light-mode styling.
- Fix `/stop`, abort handling, and unstable streamed assistant text rendering.
- Add regression tests for the above.

## Progress
- [x] Inspect current chat, storage, maintenance, and styling implementation.
- [x] Implement chat storage reset on uninstall.
- [x] Replace the configure drawer with a full-window Command Center flow.
- [x] Fix chat shell abort and streamed-text behavior.
- [x] Update styling for rounding, alignment, and light-mode contrast.
- [x] Add and update tests.
- [x] Run tests.
- [x] Run `npm run tauri dev`.
- [ ] Commit and push if the workspace is clean enough and all checks pass.
