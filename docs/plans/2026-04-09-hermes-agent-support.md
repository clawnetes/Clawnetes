# Hermes Agent Support in Clawnetes Implementation Plan

> For Hermes: use subagent-driven-development if executing this plan later.

Status: research complete, implementation not started
Owner: AI agent
Last updated: 2026-04-09

## Progress tracker
- [x] Study Clawnetes OpenClaw-specific integration points
- [x] Study Hermes Agent install, config, gateway, API server, and platform support
- [ ] Add platform abstraction in Clawnetes frontend and Tauri backend
- [ ] Implement Hermes install/prerequisite/maintenance flows
- [ ] Implement Hermes config read/write flows
- [ ] Implement Hermes chat transport via API server
- [ ] Implement Hermes remote deployment support
- [ ] Add tests for OpenClaw + Hermes coexistence
- [ ] Validate with `npm test`
- [ ] Validate with `npm run tauri dev`

## Goal
Extend Clawnetes so the same native macOS/Windows app can install, configure, launch, manage, and chat with Hermes Agent in addition to OpenClaw, without regressing the existing OpenClaw workflow.

## Recommended scope for v1
Support these Hermes scenarios first:
1. Local macOS Hermes install and management
2. Local Windows support via the Hermes-supported path used by the app today: WSL2-backed runtime for local install/config management, not a new native-Windows Hermes runtime invented by Clawnetes
3. Remote Linux Hermes deployment over SSH
4. Built-in Clawnetes chat UI connected to Hermes through Hermes’s OpenAI-compatible API server
5. Hermes messaging/gateway setup for Telegram and WhatsApp where feasible through config + gateway control

Defer from v1 unless needed:
- full Hermes profile management UI
- every Hermes platform adapter in the wizard
- deep skills marketplace parity with OpenClaw clawhub-specific flows
- every Hermes maintenance command surfaced in UI

## Source-backed findings

### Clawnetes today is strongly coupled to OpenClaw
Key OpenClaw-specific backend files:
- `src-tauri/src/main.rs`
- `src-tauri/src/install.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/gateway.rs`
- `src-tauri/src/maintenance.rs`
- `src-tauri/src/oauth.rs`
- `src-tauri/src/remote.rs`
- `src-tauri/src/types.rs`

Key OpenClaw-specific frontend files:
- `src/App.tsx`
- `src/utils/wizardControllers.ts`
- `src/utils/configPayload.ts`
- `src/hooks/useWizardState.ts`
- `src/lib/gatewayChat.ts`
- `src/components/chat/ChatShell.tsx`
- `src/components/chat/ChatHeader.tsx`
- `src/components/steps/StepSystemCheck.tsx`
- `src/components/steps/StepReview.tsx`
- `src/components/panel/SettingsPanel.tsx`
- `src/types/index.ts`

OpenClaw-specific assumptions currently hardcoded:
- CLI command names like `openclaw --version`, `openclaw gateway ...`
- file layout under `~/.openclaw/`
- JSON config in `openclaw.json`
- gateway websocket bootstrap and `openClawVersion`
- maintenance actions like doctor/security audit/update

### Hermes facts that matter for Clawnetes integration
Canonical home/config paths:
- `~/.hermes/config.yaml`
- `~/.hermes/.env`
- `~/.hermes/logs/`
- `~/.hermes/sessions/`
- `~/.hermes/auth.json`
- `~/.hermes/gateway.pid`
- `~/.hermes/gateway_state.json`

Install/runtime facts:
- Default install dir: `~/.hermes/hermes-agent`
- Primary installer: `scripts/install.sh` on macOS/Linux
- Windows installer scripts exist, but public docs still say native Windows is not supported and recommend WSL2
- Hermes supports profiles via isolated `HERMES_HOME` directories

Chat/frontend integration facts:
- Hermes includes an OpenAI-compatible API server in `gateway/platforms/api_server.py`
- Default host/port: `127.0.0.1:8642`
- Endpoints include:
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
  - `POST /v1/runs`
  - `GET /v1/runs/{run_id}/events`
  - `GET /v1/models`
  - `GET /health`
- This is the best supported integration point for the Clawnetes chat UI

Gateway/service facts:
- Hermes gateway commands exist for setup/install/start/stop/status/restart
- Runtime state is tracked in `gateway.pid` and `gateway_state.json`
- Multiple instances are naturally supported via profile-scoped `HERMES_HOME`

## Proposed architecture
Do not bolt Hermes onto the existing OpenClaw-specific code path with more conditionals. Introduce a platform layer.

### Frontend architecture
Create a platform-aware service layer in TypeScript.

New files:
- `src/platforms/types.ts`
- `src/platforms/capabilities.ts`
- `src/platforms/openclaw.ts`
- `src/platforms/hermes.ts`
- `src/platforms/index.ts`

Purpose:
- centralize platform IDs: `openclaw | hermes`
- centralize labels, install constraints, supported environments, chat transport type, maintenance capabilities
- stop scattering OpenClaw strings through React components

### Backend architecture
Create a platform-aware Tauri service layer in Rust.

New files:
- `src-tauri/src/platforms/mod.rs`
- `src-tauri/src/platforms/types.rs`
- `src-tauri/src/platforms/openclaw.rs`
- `src-tauri/src/platforms/hermes.rs`

Purpose:
- wrap platform-specific install/config/gateway/maintenance behaviors behind a common interface
- keep current OpenClaw logic as one implementation
- add Hermes as a second implementation

### Chat architecture recommendation
Keep the current OpenClaw websocket chat path for OpenClaw.
For Hermes, add a second chat transport based on Hermes API server.

Reason:
- source-backed and supported by Hermes
- simpler than reverse-engineering Hermes CLI TUI or gateway internal stream protocol
- compatible with Clawnetes’s existing native chat UI if transport is abstracted

New frontend files:
- `src/lib/chatTransport.ts`
- `src/lib/openclawChatTransport.ts`
- `src/lib/hermesChatTransport.ts`

## Design decisions to preserve existing behavior
1. OpenClaw remains the default selected platform initially so existing users are not disrupted.
2. Platform choice becomes explicit in setup and chat state.
3. OpenClaw and Hermes local state must never share the same config files or localStorage keys without platform scoping.
4. All tests that currently hardcode OpenClaw command names should become platform-scoped.

## Task plan

### Task 1: Add platform selection to shared app state
Objective: make the app aware of which agent platform is being configured or managed.

Files:
- Create: `src/platforms/types.ts`
- Modify: `src/hooks/useWizardState.ts`
- Modify: `src/types/index.ts`
- Test: `src/__tests__/wizardNavigation.test.tsx`

Steps:
1. Add a shared platform type:
```ts
export type AgentPlatform = "openclaw" | "hermes";
```
2. Add `platform` to wizard state and persisted config payloads.
3. Default to `openclaw` for backward compatibility.
4. Update tests to assert state includes platform.

Verification:
- `npm run test -- src/__tests__/wizardNavigation.test.tsx`

### Task 2: Add a platform picker to the wizard and chat entry flow
Objective: users can choose OpenClaw or Hermes before install/config begins.

Files:
- Modify: `src/components/steps/StepAgentType.tsx`
- Modify: `src/App.tsx`
- Modify: `src/utils/wizardControllers.ts`
- Test: `src/components/__tests__/addAgentModal.test.tsx`
- Test: `src/__tests__/configurationContamination.test.tsx`

Steps:
1. Extend the existing agent type step so platform and persona are separate concepts.
2. Show Hermes-specific helper copy:
   - local macOS supported
   - Windows uses WSL2-managed workflow for v1
   - remote Linux supported
3. Make all app orchestration paths read selected platform before invoking Tauri commands.

Verification:
- `npm run test -- src/components/__tests__/addAgentModal.test.tsx src/__tests__/configurationContamination.test.tsx`

### Task 3: Introduce neutral frontend platform services
Objective: remove direct OpenClaw command naming from React orchestration code.

Files:
- Create: `src/platforms/capabilities.ts`
- Create: `src/platforms/openclaw.ts`
- Create: `src/platforms/hermes.ts`
- Create: `src/platforms/index.ts`
- Modify: `src/utils/wizardControllers.ts`
- Modify: `src/App.tsx`
- Test: `src/test/configPayload.test.ts`

Suggested interface:
```ts
export interface PlatformFrontendService {
  id: AgentPlatform;
  label: string;
  supportsRemote: boolean;
  supportsLocalWindows: boolean;
  chatTransport: "openclaw-gateway" | "hermes-api";
}
```

Steps:
1. Move capability decisions out of components.
2. Route button labels and helper text through platform metadata.
3. Leave actual Rust command execution unchanged for now; this task is only frontend cleanup.

Verification:
- `npm run test -- src/test/configPayload.test.ts`

### Task 4: Introduce neutral Rust command surface
Objective: stop expanding OpenClaw-only command names in Tauri.

Files:
- Create: `src-tauri/src/platforms/mod.rs`
- Create: `src-tauri/src/platforms/types.rs`
- Create: `src-tauri/src/platforms/openclaw.rs`
- Create: `src-tauri/src/platforms/hermes.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/types.rs`
- Test: `src-tauri/src/main.rs`

Suggested command model:
```rust
pub enum AgentPlatform {
    OpenClaw,
    Hermes,
}
```

New Tauri commands to prefer:
- `check_platform_prerequisites(platform)`
- `install_platform(platform)`
- `get_platform_version(platform, remote)`
- `configure_platform(platform, config, remote)`
- `start_platform_gateway(platform, remote)`
- `restart_platform_gateway(platform, remote)`
- `validate_platform_config(platform, remote, is_wsl)`
- `run_platform_maintenance(platform, action, remote)`

Steps:
1. Keep old OpenClaw commands temporarily for compatibility while frontend migrates.
2. Add neutral commands that dispatch to platform modules.
3. Rename `openclaw_version` fields to `platform_version` in shared payloads, with compatibility adapters if needed.

Verification:
- `cargo test --manifest-path src-tauri/Cargo.toml`

### Task 5: Implement Hermes prerequisite and local install support
Objective: Clawnetes can detect and install Hermes locally.

Files:
- Modify/Create: `src-tauri/src/platforms/hermes.rs`
- Modify: `src-tauri/src/install.rs`
- Modify: `src/components/steps/StepSystemCheck.tsx`
- Test: `src/__tests__/wizardNavigation.test.tsx`
- Test: `src-tauri/src/install.rs`

Source-backed behavior to implement:
- macOS/Linux local install should use Hermes installer script or a deterministic clone+uv path
- Windows v1 should use the app’s WSL-backed strategy, because Hermes public docs still recommend WSL2
- prerequisite detection should check Hermes CLI availability and, if using local chat/API server, confirm Python/uv as needed

Recommended install strategy:
- macOS local: use deterministic clone/install under `~/.hermes/hermes-agent` or invoke Hermes install script non-interactively
- Windows local: run install inside WSL2 and expose resulting runtime through Clawnetes, matching current WSL strategy used for OpenClaw-style local management

Verification:
- `npm run test -- src/__tests__/wizardNavigation.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml install`

### Task 6: Implement Hermes config writer and reader
Objective: Clawnetes can save and reload Hermes configuration.

Files:
- Modify/Create: `src-tauri/src/platforms/hermes.rs`
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/types.rs`
- Modify: `src/utils/configPayload.ts`
- Modify: `src/types/index.ts`
- Test: `src-tauri/src/config.rs`
- Test: `src/test/configPayload.test.ts`

Source-backed Hermes config targets:
- `~/.hermes/config.yaml`
- `~/.hermes/.env`
- optional workspace/profile files under selected `HERMES_HOME`

Implementation notes:
1. Write non-secret settings to `config.yaml`.
2. Write secrets to `.env`.
3. Add platform-specific serialization for:
   - model/provider
   - toolsets
   - memory enablement
   - gateway platform blocks
   - API server enablement (`API_SERVER_ENABLED`, `API_SERVER_KEY`, etc.)
4. Read existing Hermes config back into Clawnetes state where there is a clean mapping.
5. If a setting has no clean Hermes equivalent, keep it platform-specific and hide it from Hermes UI.

Verification:
- `npm run test -- src/test/configPayload.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml config`

### Task 7: Add Hermes-specific capabilities and hide unsupported OpenClaw-only options
Objective: prevent the UI from offering features that do not map well to Hermes.

Files:
- Modify: `src/components/steps/StepGateway.tsx`
- Modify: `src/components/steps/StepToolAccess.tsx`
- Modify: `src/components/steps/StepReview.tsx`
- Modify: `src/components/panel/SettingsPanel.tsx`
- Modify: `src/components/panel/IntegrationHubPanel.tsx`
- Test: `src/components/__tests__/settingsPanel.test.tsx`
- Test: `src/components/__tests__/integrationHubPanel.test.tsx`

Examples:
- hide OpenClaw doctor/security audit buttons in Hermes mode unless Hermes equivalents are implemented
- replace OpenClaw-specific auth/profile wording with Hermes equivalents
- for Hermes, emphasize gateway setup, API server, profiles, and skills, not OpenClaw plugin flows

Verification:
- `npm run test -- src/components/__tests__/settingsPanel.test.tsx src/components/__tests__/integrationHubPanel.test.tsx`

### Task 8: Add Hermes gateway/service management
Objective: Clawnetes can start, stop, restart, and inspect Hermes runtime.

Files:
- Modify/Create: `src-tauri/src/platforms/hermes.rs`
- Modify: `src-tauri/src/gateway.rs`
- Modify: `src/components/steps/StepComplete.tsx`
- Modify: `src/components/panel/SettingsPanel.tsx`
- Test: `src-tauri/src/gateway.rs`

Source-backed Hermes controls:
- `hermes gateway install`
- `hermes gateway start`
- `hermes gateway stop`
- `hermes gateway restart`
- `hermes gateway status`
- runtime files: `gateway.pid`, `gateway_state.json`

Verification:
- `cargo test --manifest-path src-tauri/Cargo.toml gateway`

### Task 9: Add Hermes chat transport using the Hermes API server
Objective: the Clawnetes chat UI can chat with Hermes without using the OpenClaw websocket protocol.

Files:
- Create: `src/lib/chatTransport.ts`
- Create: `src/lib/hermesChatTransport.ts`
- Create: `src/lib/openclawChatTransport.ts`
- Modify: `src/lib/gatewayChat.ts`
- Modify: `src/components/chat/ChatShell.tsx`
- Modify: `src/components/chat/ChatHeader.tsx`
- Modify: `src/components/chat/ChatTranscript.tsx`
- Test: `src/__tests__/gatewayChat.test.ts`
- Test: `src/__tests__/chatShellRouting.test.tsx`
- Test: `src/__tests__/chatShellMessages.test.tsx`

Recommended Hermes transport contract:
1. Enable Hermes API server in config.
2. Ensure gateway is running.
3. Connect Clawnetes to:
   - `POST /v1/chat/completions` for normal chat
   - optionally `/v1/runs` + `/events` for richer progress
4. Preserve thread continuity via Hermes session headers or named conversations.

Important implementation note:
- do not force Hermes into the OpenClaw websocket shape
- abstract the chat transport and normalize messages into the existing Clawnetes message model

Verification:
- `npm run test -- src/__tests__/gatewayChat.test.ts src/__tests__/chatShellRouting.test.tsx src/__tests__/chatShellMessages.test.tsx`

### Task 10: Add Hermes remote deployment over SSH
Objective: Clawnetes can install and configure Hermes on a remote Linux host.

Files:
- Modify/Create: `src-tauri/src/platforms/hermes.rs`
- Modify: `src-tauri/src/remote.rs`
- Modify: `src-tauri/src/ssh.rs`
- Modify: `src/components/steps/StepEnvironment.tsx`
- Test: `src-tauri/src/remote.rs`
- Test: `e2e/helpers/ipc-mock.ts`

Recommended remote strategy:
1. Copy or invoke Hermes install flow remotely.
2. Write `config.yaml` and `.env` remotely under target `HERMES_HOME`.
3. Start Hermes gateway remotely.
4. If chat is needed in the desktop app, tunnel the Hermes API server port or keep the current remote-gateway bootstrap approach only for status and management.

Verification:
- `cargo test --manifest-path src-tauri/Cargo.toml remote`

### Task 11: Add Hermes maintenance actions
Objective: give users a safe subset of Hermes lifecycle controls.

Files:
- Modify/Create: `src-tauri/src/platforms/hermes.rs`
- Modify: `src-tauri/src/maintenance.rs`
- Modify: `src/components/panel/SettingsPanel.tsx`
- Test: `src/components/__tests__/settingsPanel.test.tsx`

Suggested Hermes actions for v1:
- update Hermes
- restart gateway
- show config/logs path
- uninstall Hermes

Do not promise unsupported one-to-one equivalents for OpenClaw actions like security audit unless source-backed Hermes equivalents exist.

Verification:
- `npm run test -- src/components/__tests__/settingsPanel.test.tsx`

### Task 12: Add platform-scoped persistence and contamination tests
Objective: ensure OpenClaw and Hermes state never leak into one another.

Files:
- Modify: `src/__tests__/configurationContamination.test.tsx`
- Modify: `src/__tests__/chatShellMessages.test.tsx`
- Modify: `src/test/chatShellStorage.test.ts`
- Modify: `e2e/helpers/ipc-mock.ts`
- Modify: `e2e/helpers/bridge-server.ts`

Test cases to add:
1. Switching from OpenClaw to Hermes does not reuse OpenClaw command names.
2. Chat thread storage is platform-scoped.
3. Config reload loads the correct platform’s version/status.
4. Uninstalling Hermes does not wipe OpenClaw UI state, and vice versa.

Verification:
- `npm run test`

### Task 13: Update docs and user-facing copy
Objective: make Hermes support discoverable and understandable.

Files:
- Modify: `README.md`
- Create: `docs/plans/2026-04-09-hermes-agent-support.md` (this file, keep updated)
- Optionally create: `docs/hermes-support.md`

Docs to add:
- supported Hermes environments for macOS, Windows/WSL2, and remote Linux
- limitations of v1
- how Clawnetes chat works for Hermes (API server)
- where Hermes files live (`~/.hermes`, profiles, logs)

Verification:
- manual docs review

## Suggested implementation order
1. Platform state + picker
2. Neutral command/service abstraction
3. Hermes install + config write/read
4. Hermes gateway management
5. Hermes chat transport
6. Hermes remote deployment
7. Tests and docs

## Risks and mitigations

### Risk 1: trying to preserve every existing OpenClaw field in a cross-platform schema
Mitigation:
- make payloads platform-aware instead of forcing a fake universal schema
- use shared fields only where semantics really match

### Risk 2: Windows local Hermes support ambiguity
Mitigation:
- v1 explicitly supports WSL2-backed local Hermes on Windows in Clawnetes
- do not market native Windows-local Hermes runtime until validated in source and manual testing

### Risk 3: chat transport complexity
Mitigation:
- use Hermes API server, not Hermes CLI internals
- keep OpenClaw websocket and Hermes API as separate transport implementations

### Risk 4: cross-platform config contamination
Mitigation:
- namespace localStorage/session keys by platform
- add contamination tests before broad UI rollout

## Verification checklist for the eventual implementation
After code changes are made, run:
1. `npm run test`
2. `cargo test --manifest-path src-tauri/Cargo.toml`
3. `npm run tauri dev`

Manual checks:
1. macOS local OpenClaw still works
2. macOS local Hermes install/config/start works
3. Hermes chat works from Clawnetes UI
4. switching platforms does not corrupt saved state
5. remote Linux Hermes deploy reaches healthy state

## Recommended first implementation milestone
Ship a narrow but real milestone first:
- platform picker
- Hermes local macOS install
- Hermes config writer
- Hermes gateway start/status
- Hermes API-server-backed chat in Clawnetes
- no remote Hermes yet

This reduces risk and proves the platform abstraction before adding remote deployment and more maintenance actions.

## Final recommendation
Treat Hermes support as a second platform implementation, not an OpenClaw feature toggle. The clean boundary is:
- install/runtime management: platform adapter
- config serialization: platform adapter
- chat transport: platform adapter
- UI capabilities: platform metadata

That structure keeps OpenClaw stable while making Hermes support realistic to maintain.
