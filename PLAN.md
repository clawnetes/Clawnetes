# Plan Status

## Goal
Complete the remaining architecture, testing, preset-source, and Tauri migration work tracked in `TODOS.md`.

## Final Status
- [x] Extract remaining `App.tsx` orchestration into focused controller logic
- [x] Add targeted memoization for extracted step components
- [x] Introduce executor abstractions for local and SSH command execution
- [x] Extract remote setup/deployment orchestration from `main.rs`
- [x] Move command-path blocking sleeps to async sleeps where appropriate
- [x] Keep frontend and backend tests passing after the refactor
- [x] Remove duplicated `agents_library/` markdown assets
- [x] Migrate the app from Tauri v1 to Tauri v2
- [x] Run `cargo test`
- [x] Run `npm test`
- [x] Run `npm run tauri dev`
- [ ] Commit and push

## Outcome Notes
- `src/App.tsx` is down to the orchestration shell and render wiring rather than owning all install/maintenance/config-loading logic inline.
- `src-tauri/src/main.rs` is down to command registration, wrappers, and test coverage support, with the large remote setup flow now in `src-tauri/src/remote.rs`.
- Tauri permissions now use the v2 capability model in `src-tauri/capabilities/default.json`.
