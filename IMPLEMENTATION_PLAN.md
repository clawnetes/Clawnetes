# Template Agent Tool Coverage Expansion

## Goal
- Ensure every shipped template agent has the built-in OpenClaw tools needed for its documented tasks.
- Expand preset tool policies from conservative minimums to role-complete access without defaulting to full unrestricted access.
- Keep template tool access explicit in preset data and preserve existing config/runtime interfaces.

## Progress
- [x] Inspect current preset definitions, business-function agent creation, and tool policy helpers.
- [x] Expand preset tool policies for shipped template agents to match intended tasks.
- [x] Add or update tests for effective template tool coverage and agent config construction.
- [x] Run `npm test`.
- [x] Run `npm run tauri dev`.
- [ ] Commit and push after validation succeeds.

## Notes
- Keep tool access explicit in preset data instead of falling back to `DEFAULT_TOOL_POLICY`.
- Preserve unrelated worktree changes.
- Favor role-complete access over ultra-minimal defaults, but avoid `full` unless a role genuinely needs it.
