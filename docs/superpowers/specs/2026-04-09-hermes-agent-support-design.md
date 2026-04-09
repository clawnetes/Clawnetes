# Hermes Agent Support Design

## Summary
Clawnetes will support Hermes Agent alongside OpenClaw by treating each configured environment as platform-scoped. An environment is either `openclaw` or `hermes`, never both. Platform selection happens before setup, and the selected platform determines which wizard, backend service implementation, chat transport, config format, and maintenance actions are used.

This design preserves the existing OpenClaw experience while adding a dedicated Hermes path for local macOS, Windows via WSL2, and remote Linux over SSH. Chat for Hermes uses the Hermes OpenAI-compatible API server and should surface Hermes multi-agent and runs features when the API server exposes them.

## Goals
- Support Hermes Agent as a first-class platform in Clawnetes.
- Preserve the current OpenClaw workflow with minimal regression risk.
- Keep OpenClaw and Hermes environments isolated in storage, configuration, chat state, and maintenance actions.
- Support these Hermes v1 scenarios:
  - local macOS install and management
  - local Windows via WSL2-backed Hermes management
  - remote Linux deployment and management over SSH
  - built-in Clawnetes chat via the Hermes API server
  - Hermes messaging and gateway setup for Telegram and WhatsApp where Hermes supports it

## Non-Goals
- Full Hermes profile-management UI.
- Full parity for every Hermes adapter or maintenance command.
- Mixing OpenClaw and Hermes inside a single environment.
- Rebuilding the OpenClaw wizard around Hermes requirements.

## Product Decisions

### Environment model
Each stored environment has a `platform` field with value `openclaw` or `hermes`.

Implications:
- Environment switching always switches platform too.
- Storage keys, chat thread caches, active environment tracking, and config baselines are scoped by environment and therefore by platform.
- Existing environments without a platform are migrated to `openclaw`.
- Users can have both a local OpenClaw environment and a local Hermes environment without config leakage.

### Setup flow
The setup entry flow begins with platform selection.

Flow:
1. Pick platform.
2. Enter the corresponding wizard.
3. Configure or deploy that platform into a dedicated environment.

OpenClaw stays the default selected platform for backward compatibility.

### Wizard model
OpenClaw keeps its existing wizard flow.

Hermes gets a separate wizard flow after platform selection. Shared UI primitives may be reused, but Hermes steps remain independent so Hermes-specific requirements do not introduce conditional complexity into the OpenClaw wizard.

### Chat model
Chat is transport-based and selected by environment platform.

- OpenClaw uses the existing gateway websocket transport.
- Hermes uses the Hermes OpenAI-compatible API server transport.

Hermes multi-agent and runs features are surfaced in the Clawnetes chat UI only if the Hermes API server exposes them for the current environment. Unsupported Hermes features are not simulated.

## Architecture

### Frontend
Add a platform-aware frontend layer:
- shared platform types and metadata
- environment records with platform
- separate wizard flow selection based on platform
- transport abstraction for chat

Recommended structure:
- `src/platforms/types.ts`
- `src/platforms/capabilities.ts`
- `src/platforms/openclaw.ts`
- `src/platforms/hermes.ts`
- `src/platforms/index.ts`
- `src/lib/chatTransport.ts`
- `src/lib/openclawChatTransport.ts`
- `src/lib/hermesChatTransport.ts`

Responsibilities:
- Define platform IDs, labels, capability flags, local/remote support, and chat transport type.
- Keep platform-specific copy and wizard choices out of generic React components.
- Route app initialization and chat bootstrap through the active environment platform.

### Backend
Add a platform-aware Tauri service layer with one implementation per platform.

Recommended structure:
- `src-tauri/src/platforms/mod.rs`
- `src-tauri/src/platforms/types.rs`
- `src-tauri/src/platforms/openclaw.rs`
- `src-tauri/src/platforms/hermes.rs`

Responsibilities:
- Wrap local and remote install flows.
- Read and write platform-specific configuration.
- Start, stop, and inspect platform-specific gateway or API services.
- Expose a neutral command surface to the frontend.
- Preserve current OpenClaw behavior by adapting existing functions instead of rewriting them wholesale.

### Neutral command surface
The frontend should stop calling OpenClaw-named commands for cross-platform operations.

The backend command surface should support:
- prerequisite checks
- local install
- remote setup
- config read
- config write
- version lookup
- gateway or API bootstrap
- maintenance actions
- messaging link and pairing actions where supported

Existing OpenClaw-only commands can remain temporarily for compatibility, but new frontend code should move toward platform-aware commands.

## Environment and storage design

### Stored environment schema
Add `platform` to the environment record.

Rules:
- Legacy records without `platform` become `openclaw`.
- Local uniqueness is per `(platform, type=local)`.
- Cloud uniqueness is per `(platform, remote user, remote host)`.

### Scoped client persistence
Scope these by environment ID and platform:
- active chat thread selection
- stored chat threads
- hidden live sessions
- device auth tokens where applicable
- bootstrap cache
- last-used environment state

This avoids OpenClaw chat state being reused against Hermes or vice versa.

## Hermes v1 functional design

### Local install and prerequisites
Hermes local setup should support:
- macOS native install using Hermes-supported installer flow
- Windows via WSL2-backed install and management

Prerequisite checks for Hermes differ from OpenClaw and should include only the Hermes runtime assumptions required by the chosen install path. Windows checks should validate WSL2 readiness rather than pretending native Windows Hermes support exists.

### Config management
Hermes configuration is stored under `~/.hermes/` and uses Hermes-native formats such as `config.yaml` and `.env`.

Clawnetes should:
- read Hermes config into a Hermes-specific review model
- write Hermes config from the Hermes wizard
- preserve Hermes-owned files that Clawnetes does not manage unless the Hermes setup explicitly owns them
- keep Hermes config handling separate from OpenClaw JSON config logic

### Gateway and API service management
Hermes v1 needs service controls for:
- setup or install
- start
- stop
- restart
- status

The backend should use Hermes runtime state such as pid or state files where possible instead of guessing based only on ports.

### Messaging
Hermes messaging support should be exposed only where Hermes supports it in its gateway and config model.

v1 target:
- Telegram support through Hermes config and gateway control where available
- WhatsApp support through Hermes config and gateway control where available

The Hermes wizard should show Hermes-specific messaging copy and avoid OpenClaw-specific pairing assumptions.

### Remote deployment
Remote Hermes environments target Linux over SSH.

The remote flow should:
- verify SSH connectivity
- verify remote prerequisites
- install or update Hermes in the remote user context
- create or update Hermes config in the remote home
- start Hermes services remotely
- expose chat bootstrap details for the app to connect through the selected transport

## Wizard design

### Shared entry
The user first selects:
- OpenClaw
- Hermes Agent

After that, the app routes into the corresponding wizard stack.

### OpenClaw wizard
Keep the existing OpenClaw wizard behavior and copy, with only the minimum changes needed to carry environment platform metadata.

### Hermes wizard
Hermes gets its own step sequence, likely covering:
- welcome and platform overview
- local vs remote target
- prerequisites and runtime checks
- install or deployment
- Hermes-specific configuration
- gateway or API server setup
- messaging setup where supported
- review and apply
- completion

The exact step count can differ from OpenClaw. Shared controls are acceptable; shared state assumptions are not.

## Chat design

### Transport abstraction
Introduce a chat transport interface that normalizes:
- bootstrap
- list sessions or runs
- create run
- stream events
- reconnect
- agent discovery

OpenClaw transport adapts the existing websocket client behavior.
Hermes transport uses Hermes API endpoints and event polling or streaming semantics exposed by Hermes.

### Hermes run support
The Hermes transport should model runs and agents as first-class concepts when exposed by Hermes. The UI should display the richer run state only when the transport provides it.

The abstraction should avoid reducing Hermes to a lowest-common-denominator single-thread chat if the API exposes more.

## Testing and validation

### Frontend
Add tests for:
- environment storage migration and platform isolation
- platform picker routing
- separate Hermes wizard rendering
- config payload isolation between OpenClaw and Hermes
- chat state isolation by environment platform

### Backend
Add tests for:
- platform enum parsing and dispatch
- Hermes prerequisite checks
- Hermes command construction for local and remote flows
- config serialization and parsing for Hermes-owned files
- non-regression of existing OpenClaw behavior

### Required validation
Before claiming completion:
- run targeted frontend tests for touched areas
- run targeted Rust tests for touched areas
- run `npm test`
- run `npm run tauri dev`
- fix every failure found in those runs

## Risks and mitigations

### Risk: OpenClaw regression from over-sharing logic
Mitigation:
- keep OpenClaw wizard intact
- isolate Hermes into parallel services and wizard flow
- add regression tests around OpenClaw environment setup and chat bootstrap

### Risk: Environment contamination
Mitigation:
- add platform to environment schema
- version storage keys if needed
- migrate legacy environments explicitly to OpenClaw

### Risk: Hermes feature mismatch
Mitigation:
- expose only source-backed Hermes features in v1
- gate richer run or multi-agent UI on actual API capability presence

### Risk: Windows local support ambiguity
Mitigation:
- explicitly treat Windows Hermes support as WSL2-backed in v1
- communicate that in the wizard and in prerequisite checks

## Implementation boundary
This design covers the full Hermes v1 support target. It does not include post-v1 work such as full profile management, universal adapter coverage, or deep marketplace parity.
