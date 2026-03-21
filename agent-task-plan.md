# Fix Windows WhatsApp Local Paths

## Summary
- Fix local WhatsApp handling on Windows so it resolves OpenClaw files from WSL home instead of native Windows home.
- Cover the remaining local WhatsApp paths: link-status checks, gateway auth token reads, and session wipe.
- Add Rust-side regression coverage for the path helpers so the WSL/local split stays correct.

## Implementation Changes
- Update `src-tauri/src/whatsapp.rs` to resolve the local OpenClaw home via WSL on Windows and reuse that for config/session paths.
- Update `src-tauri/src/pairing.rs` to check local WhatsApp link state against the same WSL-aware session path.
- Add targeted unit tests for the WhatsApp path helper output.

## Validation
- Run Rust unit tests for the Tauri backend.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if validation succeeds.
