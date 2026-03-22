# Fix Remote WhatsApp Pairing Scope Failure

## Summary
- Restore remote WhatsApp pairing when the remote gateway token does not include `operator.admin`.
- Keep the WhatsApp websocket handshake scoped to the pairing flow instead of reusing the broader chat UI scope bundle.
- Add a regression so the backend WhatsApp pairing path no longer depends on `operator.admin`.

## Implementation Changes
- Update `src-tauri/src/whatsapp.rs` so the gateway connect payload for WhatsApp login uses only the scopes required for pairing.
- Extend the Rust unit tests in `src-tauri/src/whatsapp.rs` to assert the reduced scope set and preserve gateway error parsing coverage.

## Validation
- Run targeted Rust WhatsApp tests.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if validation succeeds.
