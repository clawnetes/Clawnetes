# Fix Remote Deploy Gateway And WhatsApp Regressions

## Goal
- Restore reliable remote gateway bootstrap after OAuth completes.
- Prevent remote workspace startup from hanging indefinitely behind the gateway preparation spinner.
- Restore working WhatsApp pairing for local and remote setups.

## Steps
- [x] Trace the remote chat bootstrap path after OAuth completion.
- [x] Harden remote gateway tunnel startup so stale local tunnel state is recovered automatically.
- [x] Add timeout-bounded SSH verification and token retrieval for remote bootstrap.
- [x] Add regression tests for the new tunnel/bootstrap helpers.
- [x] Switch WhatsApp pairing back to the dedicated backend gateway flow.
- [x] Add unit coverage for the WhatsApp pairing command flow.
- [x] Run targeted tests, full `npm test`, and `npm run tauri dev`.
- [ ] Commit and push if validation succeeds.
