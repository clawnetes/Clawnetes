# Command Center and Chat Shell Fix Plan

## Scope
- Clear Clawnetes-local chat cache after uninstall.
- Make uninstall impossible before explicit in-app confirmation.
- Make repair, security audit, and upgrade impossible before explicit in-app confirmation.
- Use a short `Yes` CTA in maintenance confirmation dialogs and keep button hover contrast readable in dark mode.
- Replace the chat overlay Command Center with a full-window screen.
- Fix rounded button consistency, thread alignment, and light-mode styling.
- Fix `/stop`, abort handling, and unstable streamed assistant text rendering.
- Add regression tests for the above.

## Progress
- [x] Inspect current chat, storage, maintenance, and styling implementation.
- [x] Implement chat storage reset on uninstall.
- [x] Replace the configure drawer with a full-window Command Center flow.
- [x] Route uninstall through an app-controlled confirmation modal before any destructive action.
- [x] Route repair, security audit, and upgrade through the same app-controlled confirmation modal.
- [x] Shorten maintenance confirmation CTA text and fix dark-mode hover contrast for modal buttons.
- [x] Fix chat shell abort and streamed-text behavior.
- [x] Update styling for rounding, alignment, and light-mode contrast.
- [x] Add and update tests.
- [x] Run tests.
- [x] Run `npm run tauri dev`.
- [x] Commit and push if the workspace is clean enough and all checks pass.
