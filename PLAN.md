# Rust Backend Modularization Plan

## Goal
Finish the in-progress `main.rs` extraction by removing duplicated helper implementations and routing Tauri commands through the extracted modules without changing behavior.

## Current State
- [x] Module files created: `error`, `types`, `license`, `ssh`, `system`, `config`, `oauth`, `gateway`, `install`, `maintenance`, `models`, `pairing`
- [x] `main.rs` imports many module helpers already
- [ ] `main.rs` still contains duplicated oauth helpers
- [ ] `main.rs` still contains duplicated ssh helpers
- [ ] `main.rs` still contains command bodies that should delegate to modules
- [ ] Validation pass after cutover

## Current Cutover Tasks
- [x] Inspect duplicated helper regions and module coverage
- [x] Remove duplicated oauth helpers from `src-tauri/src/main.rs`
- [x] Remove duplicated ssh helpers from `src-tauri/src/main.rs`
- [x] Replace remaining wrapper command bodies with module calls where module APIs already exist
- [x] Run `cargo test`
- [x] Run `npm test`
- [x] Run `npm run tauri dev`
- [ ] Commit and push if all validation passes

## Notes
- Preserve unrelated user changes already present in the worktree.
- Prefer thin Tauri command wrappers in `main.rs`; keep implementation logic in modules.
- If a command still needs logic not yet exposed by a module, add the smallest safe module API instead of leaving another large body in `main.rs`.
