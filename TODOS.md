# TODOS

## Architecture

### Decompose App.tsx God Component

**What:** Extract App.tsx (4,659 lines) into WizardShell, step components, useWizardState reducer, ConfigBuilder util, and OAuthQueue hook.

**Why:** The monolithic component is untestable (0 unit tests for core logic), unmaintainable, and prone to silent state interaction bugs. A state update in one flow can trigger unrelated re-renders that reset other state.

**Context:** App.tsx contains 50+ useState calls, 20 wizard steps, config payload building, OAuth queue management, install orchestration, and all UI rendering. Accepted as issue 1A in eng review 2026-03-19. Decomposition target: WizardShell (navigation + layout), individual step components, useWizardState (useReducer + context), ConfigBuilder (constructConfigPayload extracted), OAuthQueue hook (deferred auth flow).

**Effort:** L
**Priority:** P0
**Depends on:** None

### Modularize Rust Backend + Add Tests

**What:** Extract main.rs (7,070 lines) into modules: mod license, mod ssh, mod config, mod install, mod system. Add unit tests for config generation and license crypto.

**Why:** Single-file backend with 45 commands and 0 tests. Any change risks breaking unrelated functionality with no safety net. Crypto code (AES-256-GCM license system) has never been tested.

**Context:** Accepted as issues 2A, 7A, 11A in eng review 2026-03-19. Include custom error enum (ClawError with Network, Config, License, Ssh, System variants) replacing 87 occurrences of `Result<T, String>`. Add round-trip crypto tests and config generation tests.

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

**What:** Comprehensive unit tests for constructConfigPayload — the function that converts 50+ state variables into the JSON payload sent to the backend.

**Why:** Single most critical data transformation in the app. Zero test coverage. If it drops a field, deployments silently use wrong config.

**Context:** Accepted as issue 9A in eng review 2026-03-19. Test scenarios: basic config, preset config, multi-agent, remote deployment, all-features-enabled, minimal-fields-only.

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
