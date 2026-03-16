# E2E Testing Implementation Plan

## Approach
Playwright against Vite dev server with mocked Tauri IPC.
(tauri-driver does not support macOS — it only works on Linux/Windows)

## Steps
- [x] Step 1: Install Playwright (`@playwright/test`)
- [x] Step 2: Create `playwright.config.ts` (auto-starts vite dev server)
- [x] Step 3: Create `tsconfig.e2e.json`
- [x] Step 4: Create E2E helpers (ipc-mock, selectors, wizard-actions)
- [x] Step 5: Create test spec `e2e/specs/wizard-flow.e2e.ts`
- [x] Step 6: Add npm scripts to `package.json`
- [x] Step 7: Add `data-testid` attributes to App.tsx
- [x] Step 8: Run unit tests — 114/114 pass
- [x] Step 9: Run E2E tests — 3/3 pass
- [x] Step 10: Verify build (`npm run build` + `npm run tauri dev`)
