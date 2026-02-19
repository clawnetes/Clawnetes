# Windows Support Implementation Plan

## Objective
Add Windows support with WSL2 requirement for OpenClaw installation and configuration.

## Tasks

### Phase 1: WSL2 Detection and Installation
- [x] Add `check_wsl2_installed()` function in Rust
- [x] Add `ensure_wsl2_installed()` function to install WSL2 if missing
- [x] Add `install_openclaw_windows()` function using PowerShell

### Phase 2: Shell Command Routing
- [x] Update `shell_command()` to detect Windows and route through WSL2
- [x] Update `get_env_prefix()` to handle WSL2 environment

### Phase 3: Remote Setup for Windows
- [ ] Update `setup_remote_openclaw()` to handle Windows remote targets
- [ ] Add Windows-specific SSH configuration

### Phase 4: Prerequisite Checks
- [x] Update `check_prerequisites()` to check WSL2 on Windows
- [ ] Update `check_remote_prerequisites()` for Windows remotes

### Phase 5: Testing & Validation
- [x] Test Windows build with `npm run tauri build -- --target x86_64-pc-windows-msvc`
- [x] Verify WSL2 detection works
- [x] Verify OpenClaw installation in WSL2
- [x] Run `npm run tauri dev` to test UI

## Implementation Notes
- Use PowerShell for WSL2 installation (more reliable than curl on Windows)
- Route all shell commands through WSL2 when on Windows
- Maintain backward compatibility with macOS/Linux

## Changes Made

### src-tauri/src/main.rs

1. **`get_env_prefix()`** - Added Windows (WSL2) support
2. **`shell_command()`** - Added Windows routing through WSL2
3. **`check_wsl2_installed()`** - New function to detect WSL2
4. **`ensure_wsl2_installed()`** - New function to install WSL2 if missing
5. **`install_openclaw()`** - Updated to handle Windows with WSL2
6. **`check_prerequisites()`** - Updated to check WSL2 on Windows

## Build Status
- ✅ `cargo check` passes
- ✅ `npm run tauri dev` starts successfully
- ✅ Dev server running on port 1420