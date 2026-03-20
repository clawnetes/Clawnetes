# Gateway Chat Bugfix

## Summary
- Fix the installed-state chat shell so it completes the real OpenClaw browser gateway handshake.
- Ensure the workspace loads agents and sessions, enables new chat/send actions, and surfaces connection failures clearly.
- Validate the fix end to end by running `npm run tauri dev` and exercising the chat UI with Playwright.

## Implementation Changes
- Replace the simplified `src/lib/gatewayChat.ts` client with an OpenClaw-compatible browser client flow:
  - wait for `connect.challenge`
  - send signed `connect` payload with browser client metadata
  - handle `event` and `res` frames correctly
  - retry bounded auth/device-token failures where supported
- Port the minimum browser device-auth helpers needed for the handshake.
- Tighten `ChatShell` state gating so connection progress, empty-agent states, and disabled actions are correct.
- Add/adjust unit tests for the corrected handshake and ready-state behavior.
- Add/adjust Playwright validation that checks the Clawnetes chat shell itself after install.
- Validate with `npm test`, `npm run tauri dev`, and Playwright.
- Commit and push after validation succeeds.
