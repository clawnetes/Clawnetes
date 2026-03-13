# Tool Policy Editor Follow-Up Fixes

## Goal
- Group tool rows into collapsible sections in the shared tool policy editor.
- Allow expansion and collapse only from an explicit arrow control, with all groups collapsed by default.
- Fix the toggle thumb alignment so it sits fully inside the switch track in both off and on states.
- Make profile selection immediately update the related tool toggles by clearing stale overrides when the profile changes.

## Progress
- [x] Inspect current tool policy editor UI, helper logic, and test coverage.
- [x] Update shared editor UI to grouped collapsible sections with arrow-only expansion.
- [x] Update tool profile switching logic so profile changes reset overrides but preserve elevated access.
- [x] Fix tool toggle styling so the thumb aligns to the left and right bounds correctly.
- [x] Add or update unit tests for grouped UI behavior and profile sync behavior.
- [x] Run `npm test`.
- [x] Run `npm run tauri dev`.
- [ ] Commit and push after validation succeeds.

## Notes
- Apply the shared editor changes everywhere `ToolPolicyEditor` is used.
- Preserve unrelated worktree changes.
- No config schema or backend payload changes are expected for this follow-up.
