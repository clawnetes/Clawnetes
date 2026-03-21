# Preserve Sandbox Mode During Reconfigure

## Summary
- Fix reconfigure so an existing `No Sandbox` setup stays `No Sandbox` in the wizard and in the saved config.
- Prevent invalid backend sandbox values from leaking into UI dropdown state.
- Add regression coverage for sandbox-mode mapping in both directions.

## Implementation Changes
- Centralize sandbox-mode conversion between UI values (`none` / `partial` / `full`) and config values (`off` / `non-main` / `all`).
- Use the UI mapping when loading existing config into the wizard during reconfigure.
- Use the config mapping when building the payload sent back to OpenClaw.

## Validation
- Run targeted sandbox/config tests.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if validation succeeds.
