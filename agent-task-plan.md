# WhatsApp Pairing Scope Regression

## Summary
- Trace the WhatsApp pairing failure to the backend gateway handshake and compare it against git history.
- Align the WhatsApp WebSocket connect payload with the current operator scope set used by the gateway chat client.
- Add backend regression tests for the connect payload and WhatsApp login response parsing.

## Implementation Changes
- Update `src-tauri/src/whatsapp.rs` to centralize the gateway connect payload and request parsing helpers.
- Expand the WhatsApp connect scope set to `operator.admin`, `operator.approvals`, and `operator.pairing`.
- Preserve the existing WhatsApp RPC flow for `web.login.start`, `web.login.wait`, and link-status probing.
- Add Rust unit tests covering the connect payload, gateway scope error surfacing, QR parsing, and wait response parsing.
- Validate with targeted Rust tests, `npm test`, and `npm run tauri dev`.
- If validation succeeds, commit and push the fix.
