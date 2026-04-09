# OpenClaw Agent Regression Fix Plan

## Goal

Restore OpenClaw agent chat behavior on this branch for both local and remote environments after the recent platform/chat refactor.

## Scope

- [x] Reproduce the OpenClaw regression on the current branch
- [x] Identify the specific recent change that broke OpenClaw local and remote chat bootstrap/session flow
- [x] Patch only the OpenClaw regression path without changing unrelated Hermes behavior
- [x] Add regression coverage for the broken OpenClaw behavior
- [x] Run required validation: `npm test`, relevant Rust tests if needed, and `npm run tauri dev`

## Notes

- The branch recently split platform behavior between OpenClaw and Hermes across both frontend and backend.
- The reported symptom is that remote OpenClaw enters the chat shell but stalls while preparing the gateway workspace.
- The same branch also appears to have impacted local OpenClaw behavior, so the root cause is likely shared bootstrap or transport routing code rather than SSH alone.

## Progress Log

- 2026-04-09 18:49:44 BST: Inspected the latest branch commits and isolated the main OpenClaw-related areas touched by the platform split: `src/App.tsx`, `src/hooks/useWizardState.ts`, `src/lib/chatTransport.ts`, `src/components/chat/ChatShell.tsx`, and `src-tauri/src/platforms/openclaw.rs`.
- 2026-04-09 18:49:44 BST: Began reproducing the regression by tracing the OpenClaw bootstrap path and comparing it against the new Hermes-specific command routing.
- 2026-04-09 18:53:00 BST: Confirmed the remote OpenClaw host `ubuntu@100.114.205.97` is healthy. `openclaw gateway status` reports a running gateway on `127.0.0.1:18789`, and an SSH port-forward to that gateway returned `HTTP 200`.
- 2026-04-09 18:54:30 BST: Confirmed the local client state is inconsistent: local `openclaw gateway status` reported the service listening on `18789`, while local `~/.openclaw/openclaw.json` had been rewritten to `gateway.port: 9999`.
- 2026-04-09 18:55:10 BST: Identified the client-side regression pattern. OpenClaw bootstrap was trusting the UI state's `gatewayPort`, and the shared wizard reducer allowed Hermes-derived gateway values to persist when switching back to OpenClaw. That stale value breaks local websocket bootstrap and also makes remote SSH tunnels target the wrong port.
- 2026-04-09 18:56:40 BST: Patched `src-tauri/src/gateway.rs` so OpenClaw bootstrap resolves the effective live port from gateway status/config, and remote bootstrap now restarts a stale tunnel if it was forwarding the wrong remote port.
- 2026-04-09 18:57:10 BST: Patched `src/hooks/useWizardState.ts` so switching platforms resets shared gateway fields to platform defaults, preventing Hermes gateway values from leaking back into OpenClaw state.
- 2026-04-09 18:58:30 BST: Added regression coverage in `src-tauri/src/gateway.rs` for gateway status/config port parsing and in `src/test/wizardState.test.ts` for platform-switch gateway resets.
- 2026-04-09 18:59:20 BST: Validation passed with targeted tests, full `npm test`, full `cargo test --manifest-path src-tauri/Cargo.toml`, and a clean `npm run tauri dev` startup after clearing the stale port-1420 process from the earlier failed run.

## Result

- OpenClaw local chat bootstrap no longer depends on a stale UI port when the live gateway is actually listening elsewhere.
- OpenClaw remote chat bootstrap now resolves the remote gateway port from the remote host and recovers from stale local SSH tunnels that were forwarding to the wrong remote port.
- Switching platforms now resets shared gateway state to the selected platform defaults, preventing Hermes gateway values from contaminating OpenClaw saves and later reconnects.
