# Settings Maintenance Button Wrap Plan

## Objective

Adjust the maintenance action buttons in the chat settings panel so each button renders as two stacked lines:

1. the full action label on the first line
2. the command/description on the second line

while preserving the current button behavior and panel styling.

## Scope

In scope:

1. Update `src/components/panel/SettingsPanel.tsx` only for the maintenance action button text layout.
2. Keep existing action wiring, button order, danger styling, and disabled behavior unchanged.
3. Add or update focused tests for the new label rendering.
4. Run the required validation after changes:
   - focused component tests while iterating
   - full test run
   - `npm run tauri dev`

Out of scope unless directly required:

1. wider settings page redesign
2. Configure Drawer maintenance card changes
3. unrelated panel or chat-shell fixes

## Progress

- [completed] Audit the current settings maintenance UI and related tests
- [completed] Patch the maintenance button label layout
- [completed] Add focused test coverage for the split multi-word labels
- [completed] Run required validation and record results
- [completed] Correct the implementation so the label stays intact on line one and the description stays on line two
- [completed] Re-run focused and full validation after the correction
- [in_progress] Center the two-line text inside the maintenance buttons
- [pending] Re-run focused and full validation after the centering change

## Verification Notes

1. `npx vitest run src/components/__tests__/settingsPanel.test.tsx` passed after the corrected label-on-line-one / description-on-line-two implementation.
2. `npm test` passed after the centering follow-up: 95 files, 906 tests.
3. `npm run tauri dev` initially failed because Vite port `1420` was already occupied by an existing repo dev server.
4. Re-running Tauri against that existing `http://localhost:1420` dev server succeeded by overriding only `beforeDevCommand` for the validation run.
