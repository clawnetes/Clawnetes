# Clawnetes Auth and Model Catalog Refresh

## Goal
- Fix advanced configuration auth prompts for all referenced remote providers.
- Add OAuth entry points for supported model providers through OpenClaw.
- Defer OAuth browser launches until the end of setup, after OpenClaw is installed/configured.
- Fix deferred OAuth execution so `openclaw models auth login` runs in a real terminal/TTY instead of a captured subprocess.
- Replace stale OpenClaw OAuth callback listeners before starting a fresh deferred OAuth session.
- Refresh provider model catalogs and defaults from `openclaw models list --all --json`.
- Rewrite `openai/...` model refs to `openai-codex/...` whenever Codex OAuth is selected, while normalizing them back for the UI.
- Ensure the deferred OAuth terminal wrapper writes its completion marker correctly on macOS `zsh`.
- Restore CLI-first gateway token lookup for dashboard URLs so Control UI auth uses the gateway's actual token source again.
- Make the visible OpenAI model picker switch to `openai-codex/...` while Codex OAuth is selected.

## Progress
- [x] Inspect current React/Tauri auth and model catalog flow.
- [x] Refactor shared provider auth state and advanced auth UI.
- [x] Add OpenClaw-backed OAuth login/status commands and preserve OAuth profile fields.
- [x] Defer OAuth execution to the final setup step after installation.
- [x] Refresh model catalogs/defaults/preset references from OpenClaw output.
- [x] Add and update tests.
- [x] Launch deferred OAuth in a real terminal and wait for completion markers before importing auth profiles.
- [x] Detect and replace stale OpenClaw OAuth listeners on known localhost callback ports.
- [x] Rewrite Codex OAuth model refs to the `openai-codex` namespace when saving config and normalize them back to `openai` for the UI.
- [x] Fix the macOS deferred OAuth terminal wrapper to avoid the read-only `zsh` `status` variable and unblock setup finalization.
- [x] Restore CLI-first gateway token lookup in dashboard/token helpers.
- [x] Make the visible model picker and loaded model state switch to `openai-codex/...` when Codex OAuth is active.
- [x] Run `npm test`.
- [x] Run `npm run tauri dev`.
- [x] Commit and push after successful validation.

## Notes
- Delegate provider OAuth to `openclaw models auth login`; do not implement provider-specific browser OAuth in Clawnetes.
- OpenClaw `models auth login` requires an interactive TTY, so Clawnetes must hand OAuth off to a terminal window and poll for completion.
- Callback-based OAuth providers can leave stale localhost listeners behind, so Clawnetes should clear only OpenClaw-owned listeners before retrying.
- Keep local providers (`ollama`, `lmstudio`, `local`) exempt from remote auth requirements.
- Warn on missing provider auth but do not block wizard progression.

## Investigation: Live OpenClaw State
- [x] Inspect `~/.openclaw/openclaw.json` for provider auth and model refs.
- [x] Inspect current OpenClaw logs for gateway/auth/model errors.
- [x] Correlate the runtime errors with the generated config and identify the remaining bad code path.
