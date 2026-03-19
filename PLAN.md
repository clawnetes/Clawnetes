# Remaining Work Plan

## Goal
Finish the second-pass decomposition work from `TODOS.md`: further slim the frontend and backend orchestration layers, add coverage for the deferred OAuth flow, and validate the refactor end to end.

## Current Tranche
- [x] Re-baseline `TODOS.md` and `PLAN.md` to match the post-modularization codebase
- [x] Move remaining `main.rs` command bodies into backend modules
- [x] Extract more `App.tsx` orchestration into focused hooks/controllers
- [x] Add tests for deferred OAuth queue behavior and moved orchestration logic
- [x] Run `cargo test`
- [x] Run `npm test`
- [x] Run `npm run tauri dev`
- [ ] Commit and push if all validation passes

## Backend Scope
- [x] `config.rs` owns config write/read logic
- [x] `main.rs` no longer owns WhatsApp gateway RPC flows
- [ ] `main.rs` still owns some orchestration-heavy command wrappers
- [ ] `ClawError` exists but is not yet used consistently across new backend internals

## Frontend Scope
- [x] Step rendering is split into `src/components/steps/`
- [x] reducer state lives in `src/hooks/useWizardState.ts`
- [ ] `App.tsx` still owns advanced transition, install, maintenance, and config-loading orchestration
- [ ] post-decomposition memoization still needs a focused pass

## Notes
- Keep Tauri command names and payloads stable during the refactor.
- Prefer moving full command bodies into modules over introducing new duplicate helpers.
- Validate after each tranche; do not leave stale checklist items behind.
