# Progress

- [x] Inspect the current wizard default, payload construction, and reconfigure loading paths.
- [x] Identify the backend fallback that maps missing sandbox config to `Full Sandbox`.
- [x] Update the on-disk task tracker for this fix.
- [x] Make frontend payloads persist `sandbox_mode: off` by default.
- [x] Make backend config loading default missing sandbox values to `none`.
- [x] Add/update regression tests.
- [x] Run `npm test`.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [x] Run `npm run tauri dev`.
- [x] Fix the pre-existing TypeScript build errors surfaced by `npm run build`.
- [x] Run `npm run build`.
- [x] Commit and push changes if validation succeeds.
