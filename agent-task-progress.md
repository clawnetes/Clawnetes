# Progress

- [x] Inspect the existing theme storage, chat bootstrap, and remote connection flow.
- [x] Confirm the regression source: chat defaults to `system` and can overwrite the startup dark theme on first remote connect.
- [x] Update the on-disk task tracker for this fix.
- [x] Patch chat theme storage/bootstrap behavior.
- [x] Add/update regression tests.
- [x] Run `npm test`.
- [x] Run `npm run tauri dev`.
- [x] Commit and push changes if validation succeeds.

## 2026-03-22 Startup Environment Gate + Remote Tunnel Port Split

- [x] Inspect the startup routing, target-environment step, and remote tunnel port usage.
- [x] Confirm the current regressions: local installed startup auto-enters chat, and remote SSH tunneling reuses local port `18789`.
- [x] Append the on-disk task tracker for this fix.
- [x] Patch startup routing so launch always lands on `Target Environment` before chat.
- [x] Split remote SSH tunnel access onto local port `28789` and update remote dashboard/chat flows.
- [x] Add and update regression tests and mocks.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [x] Run `npm test`.
- [x] Run `npm run tauri dev`.
- [ ] Commit and push if validation succeeds.
