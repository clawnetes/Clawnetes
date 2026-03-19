# TODOS

## Architecture

### Finish App.tsx Decomposition

**What:** Finish extracting the remaining orchestration in App.tsx into focused hooks/controllers such as WizardShell flow control, deferred OAuth execution, install/maintenance actions, and existing-config loading.

**Why:** App.tsx is much smaller than before, but it still owns too many side-effect-heavy flows. That makes cross-step state changes hard to reason about and harder to test in isolation.

**Context:** Step components, the reducer, the error boundary, and config payload utilities already exist. Remaining work is mostly orchestration: advanced/basic mode transitions, deferred provider auth completion, install and maintenance command flow, tunnel control, and config rehydration.

**Effort:** L
**Priority:** P0
**Depends on:** None

### Finish Rust Backend Decomposition + Add Tests

**What:** Continue slimming main.rs by moving the remaining orchestration-heavy command bodies into modules, then add coverage around those extracted flows.

**Why:** Backend modularization is real now, but main.rs is still large and still owns several command implementations. Keeping orchestration in modules lowers change risk and improves testability.

**Context:** `config.rs`, `oauth.rs`, `gateway.rs`, `install.rs`, `maintenance.rs`, `models.rs`, and `pairing.rs` already exist. `ClawError` also exists, but new/edited internals should start preferring it instead of extending `Result<T, String>` everywhere.

**Effort:** L
**Priority:** P0
**Depends on:** None

### Unify Local/Remote Code via Executor Trait

**What:** Create `trait CommandExecutor` with `LocalExecutor` and `SshExecutor` implementations. Unify duplicated commands (configure_agent/setup_remote_openclaw, check_prerequisites/check_remote_prerequisites, etc.).

**Why:** Every feature exists twice — once for local, once for SSH. Bugs fixed in one version are missed in the other. Codex independently flagged this as "duplicate local/remote implementations."

**Context:** Accepted as issue 3A in eng review 2026-03-19. Example: token sync at main.rs:3648 (local) vs main.rs:2336 (remote) — identical logic, duplicated. The executor trait pattern halves the maintenance surface.

**Effort:** M
**Priority:** P1
**Depends on:** Rust modularization (above)

### Convert Blocking thread::sleep to Async

**What:** Replace 17 occurrences of `thread::sleep()` in Tauri commands with `tokio::time::sleep()` in async commands.

**Why:** Blocking sleeps exhaust the Tauri thread pool during concurrent operations. verify_tunnel_connectivity() blocks for up to 60s.

**Context:** Accepted as issue 12A in eng review 2026-03-19. Medium priority — wizard app has low concurrency, but should be fixed during modularization for correctness.

**Effort:** M
**Priority:** P2
**Depends on:** Rust modularization (above)

## Frontend

### Add React Error Boundary

**What:** Add ErrorBoundary component wrapping the wizard with friendly fallback UI and "restart wizard" button.

**Why:** Any uncaught render error causes a white screen with total state loss. User loses all configuration progress.

**Context:** Accepted as issue 5A in eng review 2026-03-19. ~30 lines of code. Should be done before or during App.tsx decomposition.

**Effort:** S
**Priority:** P0
**Depends on:** None

### Add Component Memoization Post-Decomposition

**What:** Add React.memo/useMemo/useCallback to extracted wizard step components.

**Why:** After decomposition creates child components, they'll re-render on every parent state change without memoization.

**Context:** Accepted as TODO 1 in eng review 2026-03-19. Zero memoization exists today. Should be done immediately after App.tsx decomposition, not as a separate initiative.

**Effort:** S
**Priority:** P2
**Depends on:** App.tsx decomposition

## Testing

### Unit Test constructConfigPayload

**What:** Keep the existing constructConfigPayload test coverage current as App orchestration is extracted further.

**Why:** The payload builder is already covered and should stay stable while surrounding orchestration moves around it.

**Context:** This item is functionally complete; keep it here only as a reminder to avoid regressions when the remaining frontend breakup lands.

**Effort:** M
**Priority:** P0
**Depends on:** None (can test before decomposition by importing from App.tsx)

### Unit Test OAuth Deferred Queue

**What:** Extract OAuth queue into testable hook/function and add tests for: happy path, partial failure, empty queue, single provider.

**Why:** Most complex async flow in the app — chains multiple OAuth authentications. Zero test coverage. Partial failures may silently leave providers unauthenticated.

**Context:** Accepted as issue 10A in eng review 2026-03-19. 6 state variables manage this flow. Key question: does the queue continue after a mid-queue failure?

**Effort:** M
**Priority:** P1
**Depends on:** None (can extract queue logic independently)

## Security

### Fix Gateway Token Shell Injection

**What:** Wrap gateway_token in shell_single_quote() at main.rs:3648-3651 (local) and main.rs:2339 (remote SSH).

**Why:** Token is passed unsanitized into shell command. Tokens with shell metacharacters ($, ;, spaces) cause command corruption or injection.

**Context:** Accepted as issue 4A in eng review 2026-03-19. shell_single_quote() already exists at line 964 and is used elsewhere. This is a 2-line fix.

**Effort:** S
**Priority:** P0
**Depends on:** None

## Infrastructure

### Tauri v1 to v2 Migration

**What:** Migrate from Tauri v1 (1.5) to Tauri v2 for improved IPC security, async command handling, and future support.

**Why:** v1 exposes all commands to frontend without permission allowlisting. v2's permission system addresses this. v1 will eventually lose security patches.

**Context:** Accepted as TODO 3 in eng review 2026-03-19. Not urgent but should be planned. Modularization makes this easier. Breaking API changes in IPC and plugin system.

**Effort:** XL
**Priority:** P3
**Depends on:** Rust modularization

### Resolve agents_library/ Source of Truth Duplication

**What:** Either embed agents_library/ markdown files at build time, or delete the directory and keep TypeScript presets as the single source of truth.

**Why:** agents_library/ contains 120 markdown files that are copy-pasted into agentPresets.ts. Changes to markdown files don't propagate to the app.

**Context:** Accepted as TODO 2 in eng review 2026-03-19. 20 agent directories x 6 files each. Content is hand-copied into TypeScript preset objects with no build-time validation.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Completed

### ✓ Decompose App.tsx God Component (P0)
Extracted 25 step components into `src/components/steps/`. Created `useWizardState` reducer (useReducer pattern replacing 70+ useState calls), `WizardContext` for state distribution. App.tsx reduced from 4,659 → 1,706 lines (63% reduction). All 164 tests pass.

### ✓ Add React Error Boundary (P0)
Added ErrorBoundary component wrapping the wizard with fallback UI.

### ✓ Fix Gateway Token Shell Injection (P0)
Wrapped gateway_token in shell_single_quote() at both local and remote code paths.

### ✓ Unit Test constructConfigPayload (P0)
39 unit tests covering basic config, preset config, multi-agent, remote deployment, all-features-enabled, minimal-fields-only.
