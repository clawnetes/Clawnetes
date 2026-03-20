# Chat-First Clawnetes Shell

## Summary
- Turn Clawnetes into a post-install operating surface for OpenClaw instead of a setup-only wizard.
- Add a native chat shell that connects to the OpenClaw gateway, keeps sessions, starts new chats, and switches agents.
- Move repair, security audit, reconfigure, upgrade, and uninstall into a dedicated Configure panel instead of the current maintenance landing screen.

## Implementation Changes
- Add backend support to bootstrap a chat connection from Tauri:
  - resolve local or remote gateway auth token
  - restore the remote SSH tunnel when needed
  - return the effective loopback WebSocket target for the frontend
- Add a frontend gateway client that:
  - performs the gateway `connect` handshake
  - loads `agents.list`, `sessions.list`, and `chat.history`
  - sends `chat.send`, `chat.abort`, `sessions.create`, and `sessions.reset`
  - reacts to `chat`, `agent`, `health`, `tick`, and `seqGap` events
- Introduce a top-level app shell with `setup`, `chat`, and Configure states.
- Keep the existing wizard for first-time install and explicit reconfigure.
- Add unit tests for installed-state routing and core chat shell behavior.
- Validate with `npm test` and `npm run tauri dev`.
- Commit and push after validation succeeds.
