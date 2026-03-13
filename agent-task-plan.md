# Multi-Agent Tool + Session Fix Plan

## Objective
- Persist explicit per-agent tool presets from business-function agents into OpenClaw config during local installs.
- Restore the sub-agent session bootstrap so non-main agents get initialized after gateway startup.
- Keep local and remote multi-agent behavior aligned and verifiable with regression tests.

## Implementation Outline
- Patch the local Rust config writer to serialize nested `agents.list[].tools` when Clawnetes sends explicit per-agent tool settings.
- Restore the removed session bootstrap command and re-enable it in the local install flow after gateway start or restart.
- Re-add the remote SSH session bootstrap loop after remote gateway startup.
- Add regression tests for local agent tool serialization and multi-agent session initialization triggering.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push after validation succeeds.
