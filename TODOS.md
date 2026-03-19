# TODOS

## Remaining

No open implementation items remain from the 2026-03-19 refactor checklist.

## Completed

### ✓ Finish App.tsx Decomposition
Moved the remaining orchestration-heavy flows out of `src/App.tsx` into `src/utils/wizardControllers.ts` and fixed reducer field updates so functional state setters are handled correctly. `App.tsx` is now primarily state wiring and rendering.

### ✓ Finish Rust Backend Decomposition + Add Tests
Extracted the large remote deployment/setup body from `src-tauri/src/main.rs` into `src-tauri/src/remote.rs`, kept command wrappers thin, and preserved backend test coverage with the full Rust suite passing.

### ✓ Unify Local/Remote Code via Executor Trait
Added `src-tauri/src/executor.rs` with `CommandExecutor`, `LocalExecutor`, and `SshExecutor`, then used it to share prerequisite and skill-install logic and to power the extracted remote setup flow.

### ✓ Convert Blocking `thread::sleep()` to Async on Command Paths
Moved command-path sleeps in gateway/session initialization and remote setup flow to `tokio::time::sleep()`. Tight SSH forwarding loops remain thread-based in `ssh.rs`, which is the intended background-thread path.

### ✓ Add React Error Boundary
Added the error boundary wrapper earlier in the refactor and kept it in place through the final decomposition pass.

### ✓ Add Component Memoization Post-Decomposition
Memoized the extracted, props-heavy wizard step components after the orchestration move to reduce unnecessary rerenders.

### ✓ Unit Test `constructConfigPayload`
Kept the existing payload-builder coverage green through the refactor.

### ✓ Unit Test OAuth Deferred Queue
Retained the extracted OAuth completion flow and its dedicated tests.

### ✓ Fix Gateway Token Shell Injection
Kept token writes shell-quoted in local and remote command paths.

### ✓ Tauri v1 to v2 Migration
Upgraded the app to Tauri v2, switched frontend imports to the v2 API/plugin model via `src/lib/tauri.ts`, added dialog/opener plugins, and replaced the v1 allowlist config with v2 capabilities.

### ✓ Resolve `agents_library/` Source of Truth Duplication
Removed the duplicated checked-in `agents_library/` markdown tree and kept the TypeScript preset definitions as the single source of truth.
