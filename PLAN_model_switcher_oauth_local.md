# Model Switcher OAuth + Local Models Plan

## Objective

Continue the in-progress model switcher work so the chat right panel can:

1. start provider OAuth from the panel save flow when an OAuth auth method is selected
2. detect local models for Ollama, LM Studio, and custom local endpoints
3. preserve existing panel behavior without disturbing unrelated dirty worktree changes

## Scope

In scope:

1. Audit the current `App.tsx` to `ChatShell` to `RightPanel` to `ModelSwitcherPanel` callback chain.
2. Verify save-time OAuth behavior in `ModelSwitcherPanel`.
3. Verify local model detection behavior for:
   - `ollama`
   - `lmstudio`
   - `local`
4. Add or update unit tests for the completed behavior.
5. Run required validation after code changes:
   - targeted tests while iterating
   - full test run
   - `npm run tauri dev`

Out of scope unless directly required:

1. unrelated panel UI work
2. broader settings or integration flows
3. git commit or push

## Notes From Initial Audit

1. `App.tsx` already contains `handlePanelStartOAuth` and `handlePanelDetectLocalModels`.
2. `ChatShell.tsx` and `RightPanel.tsx` already expose and forward the new callbacks.
3. `ModelSwitcherPanel.tsx` already contains draft UI for save-triggered OAuth and local model detection.
4. Remaining work is likely test coverage and any edge-case fixes discovered during verification.

## Progress

- [completed] Audit current callback chain and existing implementation
- [completed] Run focused tests to identify remaining gaps
- [completed] Confirm no additional app logic patch was required beyond the existing callback wiring
- [completed] Add unit coverage for OAuth-on-save and local model detection flows
- [completed] Run full required validation including `npm test` and `npm run tauri dev`

## Verification Notes

1. `npx vitest run src/components/__tests__/modelSwitcherPanel.test.tsx` passed with the new coverage in place.
2. `npm test` passed: 95 files, 904 tests.
3. `npm run tauri dev` initially failed because Vite port `1420` was already in use by an existing repo dev server.
4. Re-running Tauri against the existing `http://localhost:1420` dev server succeeded by overriding only `beforeDevCommand` for the validation run.
