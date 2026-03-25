# Skills Toggle Fix Plan

## Objective

Correct the toggle controls used in the Skills tab so they behave like a standard slider:

1. circular visible thumb
2. off state pinned to the left
3. on state pinned to the right
4. no centered-off or hidden-on appearance

## Scope

In scope:

1. Update the shared `ToggleSwitch` primitive used by the Skills panel.
2. Add focused regression coverage for the corrected thumb geometry and state positions.
3. Run required validation:
   - focused toggle-related tests
   - full test suite
   - `npm run tauri dev`

Out of scope unless directly required:

1. redesigning the Skills panel layout
2. changing toggle colors or unrelated switch consumers
3. broader Settings or panel navigation work

## Progress

- [completed] Inspect the Skills panel and shared toggle implementation
- [completed] Patch the shared toggle geometry and state positioning
- [completed] Add focused regression coverage
- [completed] Run validation and record results

## Verification Notes

1. `npx vitest run src/components/__tests__/uiPrimitives.test.tsx src/components/__tests__/skillsPanel.test.tsx` passed.
2. `npm test` passed: 95 files, 905 tests.
3. `npm run tauri dev` initially failed because Vite port `1420` was already occupied by an existing repo dev server.
4. Re-running Tauri against that existing `http://localhost:1420` dev server succeeded by overriding only `beforeDevCommand` for the validation run.
