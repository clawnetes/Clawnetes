# Make No Sandbox the Default

## Objective
- Fix the sandbox default for reconfigure and setup flows so missing sandbox config resolves to `No Sandbox`.
- Persist `sandbox_mode: off` for new configs instead of omitting the field and inheriting an unsafe fallback.
- Add regression coverage for the frontend payload and backend config-loader behavior.

## Plan
- [completed] Update the on-disk task plan and progress tracker for the sandbox-default change.
- [completed] Change frontend config payload generation so `sandbox_mode` is always emitted from wizard state.
- [completed] Change backend config loading so missing or unknown sandbox values map to `none` instead of `full`.
- [completed] Update TypeScript and Rust tests to cover the new default and preserve explicit partial/full values.
- [completed] Run `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `npm run tauri dev`.
- [completed] Commit and push the validated fix.

## Notes
- The wizard initial state already defaults to `sandboxMode: "none"`, so the regression comes from persistence/loading, not base UI state.
- `src/utils/configPayload.ts` currently sends `sandbox_mode: null` for basic custom agents.
- `src-tauri/src/config.rs` currently falls back to `unwrap_or("full")` when no sandbox mode is present in `openclaw.json`.
- `npm run build` initially exposed unrelated TypeScript typing issues in `src/components/steps/StepComplete.tsx`, `src/__tests__/gatewayChat.test.ts`, and `src/test/whatsappPairing.test.ts`; those were fixed as part of validation so the branch now builds cleanly.
