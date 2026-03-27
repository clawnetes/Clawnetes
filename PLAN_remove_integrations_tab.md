# Remove Integrations Tab Plan

## Objective

Remove the redundant `Integrations` tab from the chat right panel because its content overlaps with `Skills`, while preserving the rest of the panel navigation and existing settings/identity/model behavior.

## Scope

In scope:

1. Update the right-panel tab definitions so `Integrations` no longer appears in navigation.
2. Remove the `integrations` panel view from the shared panel-view type.
3. Update focused tests that assert the available tabs and tab switching behavior.
4. Run required validation after the change:
   - focused component tests while iterating
   - full test suite
   - `npm run tauri dev`

Out of scope unless directly required:

1. deleting the standalone `IntegrationHubPanel` component
2. broader skills/integrations product decisions
3. redesigning the tab bar or panel styling

## Progress

- [completed] Audit the current right-panel tab wiring and tests
- [completed] Remove the redundant Integrations tab from the panel model
- [completed] Update focused tests for the reduced tab set
- [completed] Run validation and record results

## Verification Notes

1. `npx vitest run src/components/__tests__/rightPanel.test.tsx` passed.
2. `npm test` passed: 95 files, 905 tests.
3. `npm run tauri dev` initially failed because Vite port `1420` was already occupied by an existing repo dev server.
4. Re-running Tauri against that existing `http://localhost:1420` dev server succeeded by overriding only `beforeDevCommand` for the validation run.
