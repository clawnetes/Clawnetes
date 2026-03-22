# Fix Remote WhatsApp Pairing Challenge Handshake

## Objective
- Fix remote WhatsApp pairing when `web.login.start` fails with `missing scope: operator.admin`.
- Make the Rust WhatsApp gateway client perform the same challenge-aware device-auth handshake that the working webchat client uses.
- Add regression coverage for the challenge flow and validate the fix against the remote gateway.

## Plan
- [completed] Update the on-disk task plan and progress tracker with the confirmed root cause.
- [completed] Implement challenge-aware device identity generation, signing, and `connect` retries in `src-tauri/src/whatsapp.rs`.
- [completed] Add Rust regression coverage for the signed device-auth payload and challenge-aware connect message shape.
- [completed] Run targeted tests, `npm test`, and `npm run tauri dev`.
- [completed] Re-verify the remote gateway behavior and commit/push if validation succeeds.

## Progress Notes
- Confirmed on `root@100.94.24.87` that `openclaw-gateway` v`2026.3.13` rejects `web.login.start` with `missing scope: operator.admin`.
- Reproduced the failure directly against the remote gateway with the current backend handshake: a plain token-based `connect` succeeds, then `web.login.start` fails on the same socket.
- Verified the fix strategy out of band: when the same backend client responds to `connect.challenge` with a signed device-auth payload, the remote gateway grants the requested backend scopes and `web.login.start` returns a WhatsApp QR code.
- The implementation target is therefore the Rust WhatsApp handshake, not the remote server config.
- Implemented the challenge-aware backend handshake in `src-tauri/src/whatsapp.rs`, including an in-process Ed25519 device identity and signed `device` payloads for `connect.challenge`.
- Added Rust unit coverage for the device-auth payload contract, signed connect shape, connect-challenge parsing, and granted-scope validation helpers.
- Validation passed with `cargo test whatsapp --manifest-path src-tauri/Cargo.toml`, full `cargo test --manifest-path src-tauri/Cargo.toml`, `npm test`, and a successful `npm run tauri dev` launch.
- Remote verification passed by replaying the same challenge-aware backend flow against the SSH-forwarded gateway and confirming `web.login.start` returned `ok: true` with a QR payload.
