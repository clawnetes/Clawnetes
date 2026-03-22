# Preserve Theme Across Remote Chat Connect

## Objective
- Keep the current dark startup theme when opening chat against a remote server, unless the user has explicitly chosen a different theme.
- Preserve explicit `light`, `dark`, and `system` theme selections.
- Add regression coverage for the inherited dark default and explicit light preference during remote chat connect.

## Plan
- [x] Update the on-disk task plan and progress tracker for the theme regression fix.
- [x] Extend chat theme storage helpers so the app can distinguish a saved theme from "no preference saved yet".
- [x] Change chat theme bootstrap to inherit the already-rendered app theme when there is no saved user preference.
- [x] Add regression tests for storage/theme inference and remote server chat transitions.
- [x] Run `npm test` and `npm run tauri dev`.
- [x] Commit and push the validated fix.

## Notes
- The setup screens currently render in the existing dark default without an explicit `html[data-theme]` value.
- The regression happens because chat currently falls back to `system`, which can resolve to light and overwrite the visible startup theme.
- The intended behavior is to preserve the visible startup theme until the user explicitly changes it.
- Validation result: `npm test` passed, and `npm run tauri dev` reached a clean Vite + Rust launch with `target/debug/clawnetes` running before shutdown.
