# Fix Uninstall Success Gating

## Summary
- Fix the maintenance confirmation flow so uninstall only resets the app after the backend uninstall actually succeeds.
- Preserve visible error state when uninstall fails instead of falsely returning to setup as if removal completed.
- Add a regression for the failed uninstall confirmation path.

## Implementation Changes
- Update `src/utils/wizardControllers.ts` so `handleMaintenanceAction(...)` returns an explicit success flag.
- Update `src/App.tsx` so `confirmMaintenanceAction()` only calls the uninstall completion/reset path on success.
- Extend `src/__tests__/chatShellMessages.test.tsx` with a failing-uninstall regression.

## Validation
- Run targeted uninstall/maintenance tests.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if validation succeeds.
