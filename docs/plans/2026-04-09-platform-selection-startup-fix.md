# Platform Selection Startup Fix

Status: complete
Owner: AI agent
Last updated: 2026-04-09

## Goal
Restore the intended startup flow so the app asks for agent platform selection before environment selection or direct OpenClaw chat entry.

## Plan
- [x] Reproduce and isolate the startup routing path that skips platform selection
- [x] Insert a dedicated platform-selection step ahead of target-environment selection
- [x] Update wizard navigation so Hermes and OpenClaw branch from the platform choice
- [x] Update regression tests for the platform-first startup flow
- [x] Run full validation commands

## Validation
- [x] `npm test -- src/__tests__/wizardNavigation.test.tsx`
- [x] `npm test -- src/__tests__/chatShellRouting.test.tsx`
- [x] `npm test`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
- [x] `npm run tauri dev`
