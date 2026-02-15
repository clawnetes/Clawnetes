# Development Plan

## Objective
1. Decrease font sizes and button sizes in the UI.
2. Add emoji customization for agents.
3. Fix "Reconfigure" flow to load existing configuration instead of resetting.

## Tasks

- [x] **UI Polishing**
    - [x] Decrease global font size variables in `src/App.css`.
    - [x] Adjust button padding and dimensions.
    - [x] Adjust header and form element sizes.

- [x] **Emoji Support**
    - [x] Add `EMOJI_OPTIONS` constant in `src/App.tsx`.
    - [x] Add emoji picker to Main Agent setup (Step 6).
    - [x] Add emoji picker to Multi-Agent setup (Step 15.5).
    - [x] Update `handleInstall` to inject selected emoji into `IDENTITY.md`.
    - [x] Update backend `AgentData` struct to support emoji field.

- [x] **Reconfigure Flow**
    - [x] Implement `CurrentConfig` struct in Rust backend.
    - [x] Implement `get_current_config` command in `src-tauri/src/main.rs`.
        - [x] Logic to read local `openclaw.json` and `auth-profiles.json`.
        - [x] Logic to read remote config via SSH.
        - [x] Extract metadata (Emoji, Vibe) from Markdown files.
    - [x] Register command in `main`.
    - [x] Implement `loadExistingConfig` in `src/App.tsx` to populate state.
    - [x] Wire up "Reconfigure" button to `loadExistingConfig`.

- [x] **Fixes & Stabilization**
    - [x] Fix Rust compilation error (type annotation for `allowed_tools`).
    - [x] Remove unused variables in Rust backend.

- [x] **Validation & Testing**
    - [x] Create Rust unit test for `CurrentConfig` deserialization.
    - [x] Run `cargo test`.
    - [x] Verify build with `cargo check`.
    - [ ] Run `npm run tauri dev` (briefly) to ensure frontend builds.

- [ ] **Completion**
    - [ ] Git commit and push.
