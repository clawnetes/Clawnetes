# Fix Remote WhatsApp Pairing False Timeout

## Objective
- Fix remote WhatsApp pairing when QR scanning succeeds but the UI still reports a timeout.
- Preserve the existing gateway transport changes already present in `src-tauri/src/whatsapp.rs`.
- Validate the fix, then commit and push the branch updates.

## Plan
- [completed] Inspect the existing WhatsApp pairing flow and confirm where the false timeout occurs.
- [completed] Update the WhatsApp pairing flow to treat linked-session confirmation as the success source of truth.
- [completed] Add regression tests for the recovered pairing path and retained failure path.
- [completed] Run `npm test`, `cargo test`, and `npm run tauri dev`.
- [completed] Commit and push the validated fix.

## Progress Notes
- Confirmed the current false timeout comes from `runWhatsAppPairingCommandFlow` throwing immediately when `wait_whatsapp_login` returns `false`, before the linked-session poll can recover.
- Found pre-existing uncommitted transport/auth changes in `src-tauri/src/whatsapp.rs`; those will be kept intact and included with this task if validation succeeds.
- Updated the WhatsApp pairing flow to allow linked-session confirmation to recover from a `wait_whatsapp_login` false result.
- Added frontend regression coverage for the recovered success path and the retained double-failure path.
- Validation passed with `npm test`, `cargo test`, and a successful `npm run tauri dev` launch after clearing a stale local Vite listener on port `1420`.
- Created commit `34fc9bb8` and pushed the fix to `origin/add_ui`.
- Follow-up regression diagnosis: the WhatsApp gateway handshake was incorrectly identifying as `openclaw-control-ui` in `ui` mode, which triggered `CONTROL_UI_DEVICE_IDENTITY_REQUIRED`.
- Restored the backend gateway client identity (`gateway-client` / `backend`) and added a Rust regression test to lock that behavior.
- Follow-up regression diagnosis: the pairing scope bundle had been narrowed away from the previously working backend scope set.
- Restored the broader WhatsApp gateway scope bundle to include `operator.admin`, `operator.approvals`, and `operator.pairing`, while keeping the timeout-flow fix intact.
