# SSH Environment Pollution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop remote SSH-backed configuration changes from mutating the local OpenClaw environment through hidden shared client-side state.

**Architecture:** Remove the legacy single-slot remote fallback from the setup flow and keep environment selection sourced from the explicit environment registry plus active in-memory selection only. Cover the regression with focused tests around environment storage and wizard environment selection so remote state cannot silently bleed into local operations.

**Tech Stack:** React, TypeScript, Vitest, Tauri

---

## File Map

- Modify: `src/components/steps/StepEnvironment.tsx`
- Modify: `src/lib/environmentStorage.ts`
- Modify: `src/test/environmentStorage.test.ts`
- Modify: `src/__tests__/wizardNavigation.test.tsx`

## Progress

- [x] Investigate the environment-selection and config-routing paths.
- [x] Write a failing regression test for legacy remote fallback pollution.
- [x] Implement the minimal fix in environment selection/storage.
- [x] Run targeted tests and confirm green.
- [x] Run the full test suite.
- [x] Run `npm run tauri dev` and fix any issues surfaced there.

## Notes

- Root-cause candidate identified during investigation: `src/components/steps/StepEnvironment.tsx` auto-populates SSH fields from `clawnetes.remote.lastConnection.v1`, which is global shared state and not the currently selected environment.
- Keep scope limited to environment contamination. Do not refactor unrelated setup or chat flows.
