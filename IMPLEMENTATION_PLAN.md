# Template Tool Policy And Arrow Follow-Up Fixes

## Goal
- Make the tool group chevrons match the existing Extra Settings accordion arrows.
- Ensure shipped agent templates have task-appropriate tool policies instead of inheriting a generic default.
- Add explicit tool policy support to business-function preset agents so roles like Report Generator get the tools they need.

## Progress
- [x] Inspect current accordion styles, preset structures, and agent construction flow.
- [x] Update tool group chevrons to match the Extra Settings accordion behavior and styling.
- [x] Add explicit `toolPolicy` support to preset agent definitions.
- [x] Update shipped preset data so each template gets task-sufficient tool access.
- [x] Add or update tests for chevron behavior and preset tool-policy application.
- [x] Run `npm test`.
- [x] Run `npm run tauri dev`.
- [ ] Commit and push after validation succeeds.

## Notes
- Apply the shared arrow styling consistently between ToolPolicyEditor and Extra Settings.
- Preserve unrelated worktree changes.
- Keep tool access conservative: narrowest practical profile plus needed overrides.
