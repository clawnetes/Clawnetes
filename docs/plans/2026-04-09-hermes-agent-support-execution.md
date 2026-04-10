# Hermes Agent Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full v1 Hermes Agent support to Clawnetes as a second platform with separate environments, a separate Hermes wizard, Hermes-specific backend services, and Hermes chat via the Hermes API server without regressing the existing OpenClaw workflow.

**Architecture:** Environments become platform-scoped (`openclaw` or `hermes`), the frontend routes into platform-specific wizard and chat flows, and the Tauri backend dispatches platform-aware commands to OpenClaw or Hermes implementations. OpenClaw keeps its current wizard and websocket path; Hermes gets a separate wizard and a new API-server-backed chat transport.

**Tech Stack:** React, TypeScript, Vitest, Tauri, Rust

---

## Progress tracker
- [x] Task 1: Add platform and environment foundations
- [x] Task 2: Add platform-aware storage and migration coverage
- [x] Task 3: Add frontend platform metadata and selection flow
- [x] Task 4: Add separate Hermes wizard state and UI routing
- [x] Task 5: Add frontend chat transport abstraction
- [x] Task 6: Add backend platform types and neutral command surface
- [x] Task 7: Implement Hermes local install and prerequisite flows
- [x] Task 8: Implement Hermes config read/write flows
- [x] Task 9: Implement Hermes gateway, API bootstrap, and messaging support
- [x] Task 10: Implement Hermes remote deployment flows
- [x] Task 11: Wire Hermes chat, runs, and multi-agent UI behavior
- [x] Task 12: Add coexistence and non-regression tests
- [x] Task 13: Run full validation and fix failures
- [x] Task 14: Split Hermes from OpenClaw config lifecycle and payload shaping
- [x] Task 15: Replace Hermes chat settings with Hermes-native structured sections plus raw editors
- [x] Task 16: Expand Hermes wizard/reconfigure flow to Hermes-native config sections
- [x] Task 17: Add regression coverage for Hermes reconfigure, settings visibility, and model persistence
- [x] Task 18: Re-run full validation after Hermes-native overhaul
- [x] Task 19: Fix Hermes model switching config corruption and Gemini persistence

## 2026-04-09 follow-on execution note

This execution file originally covered initial Hermes support. The current implementation pass extends it to address the remaining branch gaps identified during review:

- Hermes still reuses OpenClaw-shaped payload transforms in several save/load paths.
- Hermes chat settings only expose a small subset of Hermes config.
- `Reconfigure` still routes through OpenClaw-oriented setup expectations.
- Panel-side model changes can drop Hermes-specific config on persistence.
- Platform/environment switching still risks stale incompatible state leaking into Hermes UI.

## File map

### Frontend files to modify
- `src/App.tsx`
- `src/hooks/useWizardState.ts`
- `src/types/index.ts`
- `src/lib/environmentStorage.ts`
- `src/lib/gatewayChat.ts`
- `src/utils/wizardControllers.ts`
- `src/utils/configPayload.ts`
- `src/components/steps/StepAgentType.tsx`
- `src/components/steps/StepSystemCheck.tsx`
- `src/components/steps/StepReview.tsx`
- `src/components/chat/ChatShell.tsx`
- `src/components/chat/ChatHeader.tsx`
- `src/components/panel/SettingsPanel.tsx`

### Frontend files to create
- `src/platforms/types.ts`
- `src/platforms/capabilities.ts`
- `src/platforms/openclaw.ts`
- `src/platforms/hermes.ts`
- `src/platforms/index.ts`
- `src/lib/chatTransport.ts`
- `src/lib/openclawChatTransport.ts`
- `src/lib/hermesChatTransport.ts`
- `src/components/steps/hermes/StepHermesWelcome.tsx`
- `src/components/steps/hermes/StepHermesTarget.tsx`
- `src/components/steps/hermes/StepHermesSystemCheck.tsx`
- `src/components/steps/hermes/StepHermesInstall.tsx`
- `src/components/steps/hermes/StepHermesConfig.tsx`
- `src/components/steps/hermes/StepHermesMessaging.tsx`
- `src/components/steps/hermes/StepHermesReview.tsx`

### Backend files to modify
- `src-tauri/src/main.rs`
- `src-tauri/src/types.rs`
- `src-tauri/src/install.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/gateway.rs`
- `src-tauri/src/maintenance.rs`
- `src-tauri/src/remote.rs`

### Backend files to create
- `src-tauri/src/platforms/mod.rs`
- `src-tauri/src/platforms/types.rs`
- `src-tauri/src/platforms/openclaw.rs`
- `src-tauri/src/platforms/hermes.rs`

### Tests to modify or add
- `src/__tests__/wizardNavigation.test.tsx`
- `src/__tests__/configurationContamination.test.tsx`
- `src/__tests__/gatewayChat.test.ts`
- `src/test/configPayload.test.ts`
- `src/test/environmentStorage.test.ts`
- `src/components/__tests__/chatComponents.test.tsx`
- `src/components/__tests__/settingsPanel.test.tsx`
- `src/components/__tests__/addAgentModal.test.tsx`
- `src-tauri/src/install.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/platforms/hermes.rs`

### Validation commands
- `npm test`
- `npm run tauri dev`

## Task 1: Add platform and environment foundations

**Files:**
- Create: `src/platforms/types.ts`
- Modify: `src/types/index.ts`
- Modify: `src/hooks/useWizardState.ts`
- Test: `src/__tests__/wizardNavigation.test.tsx`

- [x] **Step 1: Write the failing frontend test for platform state**

Add a wizard-state expectation that the state shape includes a default `platform` of `openclaw`, and that updating the selected platform does not disturb existing navigation fields.

Run: `npm test -- src/__tests__/wizardNavigation.test.tsx`
Expected: FAIL because `platform` is not in the state model.

- [x] **Step 2: Add shared platform types**

Create:
```ts
export type AgentPlatform = "openclaw" | "hermes";

export type ChatTransportKind = "openclaw-gateway" | "hermes-api";
```

Add platform-bearing types in `src/types/index.ts` for:
- environment platform
- platform-aware chat bootstrap metadata
- Hermes run capability flags

- [x] **Step 3: Extend wizard state**

Add to `WizardState` and `INITIAL_WIZARD_STATE`:
```ts
platform: "openclaw",
```

Keep existing OpenClaw defaults intact, and do not change unrelated wizard fields.

- [x] **Step 4: Run the targeted test and make it pass**

Run: `npm test -- src/__tests__/wizardNavigation.test.tsx`
Expected: PASS

- [x] **Step 5: Mark task progress in this plan**

Change:
- `Task 1: Add platform and environment foundations` to checked

## Task 2: Add platform-aware storage and migration coverage

**Files:**
- Modify: `src/lib/environmentStorage.ts`
- Modify: `src/types/index.ts`
- Test: `src/test/environmentStorage.test.ts`
- Test: `src/__tests__/configurationContamination.test.tsx`

- [x] **Step 1: Write the failing environment migration and isolation tests**

Cover:
- legacy environments without `platform` become `openclaw`
- local OpenClaw and local Hermes environments are distinct
- remote uniqueness is `(platform, remoteUser, remoteIp)`

Run: `npm test -- src/test/environmentStorage.test.ts src/__tests__/configurationContamination.test.tsx`
Expected: FAIL because environment records do not carry `platform`.

- [x] **Step 2: Update stored environment schema**

Add:
```ts
platform: AgentPlatform;
```

Adjust validation, migration, naming, and upsert logic so the same local machine can hold separate local OpenClaw and Hermes entries.

- [x] **Step 3: Scope chat and configuration persistence keys by platform-aware environment**

Update helpers that derive chat scope or environment identity so OpenClaw state cannot be reused in Hermes sessions.

- [x] **Step 4: Run targeted storage tests**

Run: `npm test -- src/test/environmentStorage.test.ts src/__tests__/configurationContamination.test.tsx`
Expected: PASS

- [x] **Step 5: Mark task progress in this plan**

Change:
- `Task 2: Add platform-aware storage and migration coverage` to checked

## Task 3: Add frontend platform metadata and selection flow

**Files:**
- Create: `src/platforms/capabilities.ts`
- Create: `src/platforms/openclaw.ts`
- Create: `src/platforms/hermes.ts`
- Create: `src/platforms/index.ts`
- Modify: `src/components/steps/StepAgentType.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/__tests__/addAgentModal.test.tsx`

- [x] **Step 1: Write the failing platform-selection UI test**

Cover:
- OpenClaw shown as default
- Hermes selectable
- Hermes copy mentions WSL2-backed Windows support

Run: `npm test -- src/components/__tests__/addAgentModal.test.tsx`
Expected: FAIL because platform selection metadata does not exist.

- [x] **Step 2: Add platform metadata modules**

Define one metadata object per platform with:
```ts
id
label
description
supportsRemote
supportsLocalWindows
chatTransport
defaultEnvironmentName
```

- [x] **Step 3: Update the setup entry step to pick platform first**

Modify `StepAgentType.tsx` so platform selection is separate from persona or agent preset selection.

- [x] **Step 4: Route app setup by selected platform**

Update `App.tsx` to:
- persist selected platform in the active wizard state
- branch into OpenClaw or Hermes wizard flows
- keep OpenClaw as the default initial selection

- [x] **Step 5: Run the targeted platform-selection test**

Run: `npm test -- src/components/__tests__/addAgentModal.test.tsx`
Expected: PASS

- [x] **Step 6: Mark task progress in this plan**

Change:
- `Task 3: Add frontend platform metadata and selection flow` to checked

## Task 4: Add separate Hermes wizard state and UI routing

**Files:**
- Create: `src/components/steps/hermes/StepHermesWelcome.tsx`
- Create: `src/components/steps/hermes/StepHermesTarget.tsx`
- Create: `src/components/steps/hermes/StepHermesSystemCheck.tsx`
- Create: `src/components/steps/hermes/StepHermesInstall.tsx`
- Create: `src/components/steps/hermes/StepHermesConfig.tsx`
- Create: `src/components/steps/hermes/StepHermesMessaging.tsx`
- Create: `src/components/steps/hermes/StepHermesReview.tsx`
- Modify: `src/App.tsx`
- Modify: `src/hooks/useWizardState.ts`
- Test: `src/__tests__/wizardNavigation.test.tsx`

- [x] **Step 1: Write the failing Hermes wizard routing tests**

Cover:
- selecting Hermes enters Hermes-specific steps
- OpenClaw still renders existing steps
- remote Hermes path is separate from OpenClaw path

Run: `npm test -- src/__tests__/wizardNavigation.test.tsx`
Expected: FAIL because Hermes-specific step routing does not exist.

- [x] **Step 2: Add Hermes-specific wizard step definitions**

Add Hermes-only step IDs and minimal state fields required for:
- install mode
- config format fields
- API server settings
- Hermes messaging and run controls

- [x] **Step 3: Implement Hermes step components**

Create focused components that reuse shared primitives where appropriate, but keep Hermes copy and field mappings separate from OpenClaw-specific assumptions.

- [x] **Step 4: Wire Hermes wizard rendering in `App.tsx`**

Branch the step renderer based on `platform`, without rewriting the existing OpenClaw step sequence.

- [x] **Step 5: Run the targeted wizard test**

Run: `npm test -- src/__tests__/wizardNavigation.test.tsx`
Expected: PASS

- [ ] **Step 6: Mark task progress in this plan**

Change:
- `Task 4: Add separate Hermes wizard state and UI routing` to checked

## Task 5: Add frontend chat transport abstraction

**Files:**
- Create: `src/lib/chatTransport.ts`
- Create: `src/lib/openclawChatTransport.ts`
- Create: `src/lib/hermesChatTransport.ts`
- Modify: `src/lib/gatewayChat.ts`
- Modify: `src/components/chat/ChatShell.tsx`
- Modify: `src/components/chat/ChatHeader.tsx`
- Test: `src/__tests__/gatewayChat.test.ts`
- Test: `src/components/__tests__/chatComponents.test.tsx`

- [ ] **Step 1: Write failing transport-selection and Hermes run tests**

Cover:
- OpenClaw uses websocket transport
- Hermes uses API transport
- Hermes run and agent metadata can be surfaced when present

Run: `npm test -- src/__tests__/gatewayChat.test.ts src/components/__tests__/chatComponents.test.tsx`
Expected: FAIL because only OpenClaw websocket chat exists.

- [ ] **Step 2: Define a normalized transport interface**

Define operations for:
- bootstrap
- connect or initialize
- list conversations or runs
- send message or create run
- subscribe or poll for events
- discover agents

- [ ] **Step 3: Adapt OpenClaw chat into the transport interface**

Wrap existing `GatewayChatClient` behavior without changing the wire protocol.

- [ ] **Step 4: Add Hermes API transport**

Implement Hermes transport against the Hermes API server bootstrap and run/event APIs, keeping run metadata in a Hermes-aware model.

- [ ] **Step 5: Update chat UI to read transport capabilities**

Expose richer status, agent, and run details only when the selected transport provides them.

- [ ] **Step 6: Run targeted chat tests**

Run: `npm test -- src/__tests__/gatewayChat.test.ts src/components/__tests__/chatComponents.test.tsx`
Expected: PASS

- [ ] **Step 7: Mark task progress in this plan**

Change:
- `Task 5: Add frontend chat transport abstraction` to checked

## Task 6: Add backend platform types and neutral command surface

**Files:**
- Create: `src-tauri/src/platforms/mod.rs`
- Create: `src-tauri/src/platforms/types.rs`
- Create: `src-tauri/src/platforms/openclaw.rs`
- Create: `src-tauri/src/platforms/hermes.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/types.rs`
- Test: `src-tauri/src/platforms/hermes.rs`

- [ ] **Step 1: Write failing Rust tests for platform dispatch**

Cover:
- `AgentPlatform` parsing and serialization
- platform-specific dispatch for version or install commands

Run: `cargo test platform --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because platform types and dispatch do not exist.

- [ ] **Step 2: Add backend platform types**

Define:
```rust
pub enum AgentPlatform {
    Openclaw,
    Hermes,
}
```

Add request and response structs for platform-aware prerequisite, version, config, maintenance, and bootstrap commands.

- [ ] **Step 3: Create OpenClaw and Hermes platform modules**

Move or wrap existing OpenClaw-specific logic into `platforms/openclaw.rs`, and define Hermes entry points in `platforms/hermes.rs`.

- [ ] **Step 4: Add neutral Tauri commands in `main.rs`**

Add commands for:
- `check_platform_prerequisites`
- `install_platform`
- `get_platform_version`
- `get_platform_config`
- `configure_platform`
- `start_platform_service`
- `restart_platform_service`
- `prepare_platform_chat_bootstrap`
- `run_platform_maintenance`

- [ ] **Step 5: Run the Rust platform tests**

Run: `cargo test platform --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 6: Mark task progress in this plan**

Change:
- `Task 6: Add backend platform types and neutral command surface` to checked

## Task 7: Implement Hermes local install and prerequisite flows

**Files:**
- Modify: `src-tauri/src/install.rs`
- Modify: `src-tauri/src/platforms/hermes.rs`
- Modify: `src-tauri/src/types.rs`
- Test: `src-tauri/src/install.rs`

- [ ] **Step 1: Write failing Rust tests for Hermes local prerequisite detection**

Cover:
- macOS Hermes prerequisite detection
- Windows WSL2-backed detection
- command construction for Hermes install

Run: `cargo test hermes_install --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because Hermes install helpers do not exist.

- [ ] **Step 2: Add Hermes prerequisite and install helpers**

Implement local checks and install commands using Hermes-supported install paths, including WSL2-backed execution on Windows.

- [ ] **Step 3: Connect Hermes install helpers to the neutral platform commands**

Return Hermes-specific status without overloading `openclaw_installed`.

- [ ] **Step 4: Run the targeted Rust install tests**

Run: `cargo test hermes_install --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 5: Mark task progress in this plan**

Change:
- `Task 7: Implement Hermes local install and prerequisite flows` to checked

## Task 8: Implement Hermes config read/write flows

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/types.rs`
- Modify: `src/utils/configPayload.ts`
- Modify: `src/utils/wizardControllers.ts`
- Test: `src/test/configPayload.test.ts`
- Test: `src-tauri/src/config.rs`

- [ ] **Step 1: Write failing config tests for Hermes payloads**

Cover:
- Hermes payload does not serialize as OpenClaw JSON
- Hermes-specific fields route to Hermes config handling
- OpenClaw payload remains unchanged

Run: `npm test -- src/test/configPayload.test.ts`
Expected: FAIL because config payloads are OpenClaw-shaped only.

Run: `cargo test hermes_config --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because Hermes config parsing and writing do not exist.

- [ ] **Step 2: Add frontend payload branching**

Extend `constructConfigPayload` with `platform`, and split OpenClaw and Hermes payload construction so OpenClaw output remains stable.

- [ ] **Step 3: Add backend Hermes config loading and saving**

Read and write Hermes-managed files under `~/.hermes/`, keeping YAML or env handling separate from OpenClaw JSON config code.

- [ ] **Step 4: Update config-loading controllers**

Route existing-config loading, normalization, and review through the active environment platform.

- [ ] **Step 5: Run targeted config tests**

Run: `npm test -- src/test/configPayload.test.ts`
Expected: PASS

Run: `cargo test hermes_config --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 6: Mark task progress in this plan**

Change:
- `Task 8: Implement Hermes config read/write flows` to checked

## Task 9: Implement Hermes gateway, API bootstrap, and messaging support

**Files:**
- Modify: `src-tauri/src/gateway.rs`
- Modify: `src-tauri/src/maintenance.rs`
- Modify: `src-tauri/src/platforms/hermes.rs`
- Modify: `src/components/steps/hermes/StepHermesMessaging.tsx`
- Modify: `src/components/panel/SettingsPanel.tsx`
- Test: `src/components/__tests__/settingsPanel.test.tsx`
- Test: `src-tauri/src/platforms/hermes.rs`

- [ ] **Step 1: Write failing tests for Hermes service bootstrap and settings**

Cover:
- Hermes start or restart flows
- Hermes API bootstrap payload
- Hermes messaging controls shown only in Hermes environments

Run: `npm test -- src/components/__tests__/settingsPanel.test.tsx`
Expected: FAIL because settings are OpenClaw-specific.

Run: `cargo test hermes_gateway --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because Hermes service control does not exist.

- [ ] **Step 2: Add Hermes service lifecycle helpers**

Implement:
- status
- start
- stop
- restart
- bootstrap metadata for chat

- [ ] **Step 3: Add Hermes maintenance and messaging control paths**

Support Hermes-specific maintenance actions exposed in v1, plus Telegram and WhatsApp setup only where Hermes supports them.

- [ ] **Step 4: Update frontend settings and review surfaces**

Show platform-specific maintenance actions, service status, and messaging controls without changing OpenClaw behavior.

- [ ] **Step 5: Run targeted gateway and settings tests**

Run: `npm test -- src/components/__tests__/settingsPanel.test.tsx`
Expected: PASS

Run: `cargo test hermes_gateway --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 6: Mark task progress in this plan**

Change:
- `Task 9: Implement Hermes gateway, API bootstrap, and messaging support` to checked

## Task 10: Implement Hermes remote deployment flows

**Files:**
- Modify: `src-tauri/src/remote.rs`
- Modify: `src-tauri/src/install.rs`
- Modify: `src-tauri/src/platforms/hermes.rs`
- Modify: `src/utils/wizardControllers.ts`
- Test: `src-tauri/src/platforms/hermes.rs`

- [ ] **Step 1: Write failing tests for Hermes remote setup commands**

Cover:
- prerequisite checks over SSH
- install or update command construction
- remote config placement and service start

Run: `cargo test hermes_remote --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because remote Hermes setup does not exist.

- [ ] **Step 2: Add remote Hermes setup helpers**

Implement a remote flow that:
- verifies SSH
- installs or updates Hermes
- writes config
- starts services
- returns bootstrap data

- [ ] **Step 3: Route frontend deploy controllers to Hermes remote commands**

Update install and maintenance controllers to call the platform-aware backend based on the selected environment platform.

- [ ] **Step 4: Run targeted remote tests**

Run: `cargo test hermes_remote --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 5: Mark task progress in this plan**

Change:
- `Task 10: Implement Hermes remote deployment flows` to checked

## Task 11: Wire Hermes chat, runs, and multi-agent UI behavior

**Files:**
- Modify: `src/components/chat/ChatShell.tsx`
- Modify: `src/components/chat/ChatHeader.tsx`
- Modify: `src/lib/chatTransport.ts`
- Modify: `src/lib/hermesChatTransport.ts`
- Test: `src/components/__tests__/chatComponents.test.tsx`
- Test: `src/__tests__/gatewayChat.test.ts`

- [ ] **Step 1: Write failing UI tests for Hermes run and agent display**

Cover:
- Hermes environments show Hermes-specific status labels
- multi-agent or run metadata appears when transport provides it
- OpenClaw environments remain unchanged

Run: `npm test -- src/components/__tests__/chatComponents.test.tsx src/__tests__/gatewayChat.test.ts`
Expected: FAIL because the chat UI assumes OpenClaw bootstrap data.

- [ ] **Step 2: Generalize chat bootstrap and header rendering**

Add platform-aware labels, bootstrap metadata, and capability checks.

- [ ] **Step 3: Store and restore Hermes threads separately**

Use environment-platform-scoped keys for thread persistence and active selections.

- [ ] **Step 4: Run targeted chat behavior tests**

Run: `npm test -- src/components/__tests__/chatComponents.test.tsx src/__tests__/gatewayChat.test.ts`
Expected: PASS

- [ ] **Step 5: Mark task progress in this plan**

Change:
- `Task 11: Wire Hermes chat, runs, and multi-agent UI behavior` to checked

## Task 12: Add coexistence and non-regression tests

**Files:**
- Modify: `src/__tests__/configurationContamination.test.tsx`
- Modify: `src/components/__tests__/settingsPanel.test.tsx`
- Modify: `src/test/environmentStorage.test.ts`
- Modify: `src-tauri/src/install.rs`
- Modify: `src-tauri/src/config.rs`

- [ ] **Step 1: Add failing coexistence coverage**

Cover:
- local OpenClaw and local Hermes environments coexist
- switching environments switches platform-specific chat and settings behavior
- OpenClaw config load and save still work

Run: `npm test -- src/__tests__/configurationContamination.test.tsx src/components/__tests__/settingsPanel.test.tsx src/test/environmentStorage.test.ts`
Expected: FAIL until all platform-scoping is in place.

- [ ] **Step 2: Add final regression assertions**

Add explicit assertions for:
- OpenClaw default platform migration
- OpenClaw wizard defaults
- OpenClaw maintenance actions
- OpenClaw chat labels and bootstrap behavior

- [ ] **Step 3: Run the targeted coexistence test suite**

Run: `npm test -- src/__tests__/configurationContamination.test.tsx src/components/__tests__/settingsPanel.test.tsx src/test/environmentStorage.test.ts`
Expected: PASS

- [ ] **Step 4: Run Rust regression tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 5: Mark task progress in this plan**

Change:
- `Task 12: Add coexistence and non-regression tests` to checked

## Task 13: Run full validation and fix failures

**Files:**
- Modify: any files required by test or dev-run failures

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Run the Tauri development app**

Run: `npm run tauri dev`
Expected: app starts without TypeScript, Rust, or runtime errors

- [ ] **Step 3: Fix any failures found**

If either full run fails, patch the specific failing files and rerun the command that failed before proceeding.

- [ ] **Step 4: Update the progress tracker at the top of this plan**

Mark all completed tasks and add a short final note with any residual risks or deferred Hermes gaps that remain outside v1 scope.
