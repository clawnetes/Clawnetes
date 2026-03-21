# Fix Remote Deploy OAuth And WhatsApp Regressions

## Goal
- Restore deferred local OAuth for remote deployments by launching `openclaw` inside a bootstrapped local shell environment.
- Keep the secure WhatsApp pairing client, but make it fail fast instead of hanging and ensure tunneled gateway pairing completes or surfaces a clear error.

## Steps
- [x] Update local OAuth terminal script generation to bootstrap PATH / shell env before running `openclaw`.
- [x] Improve OAuth exit-code `127` handling with a specific missing-CLI error.
- [x] Harden secure WhatsApp pairing with client-side connect / RPC timeouts.
- [x] Add regression tests for OAuth script generation and gateway secure pairing timeout behavior.
- [x] Run targeted tests, full `npm test`, and `npm run tauri dev`.
- [ ] Commit and push if validation succeeds.
