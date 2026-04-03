# Custom Local Provider Fix Plan

## Goal
Keep the Custom Local UI contract stable while fixing the runtime config contract that OpenClaw actually resolves.

## Implementation
1. Update frontend Custom Local defaults, placeholders, and save flows to use `http://localhost:8080`.
2. Persist Custom Local base URL changes from the chat model editor, not just model changes.
3. Normalize Custom Local config writing in Rust for both local and remote paths:
   - persist runtime model refs under the real `llamacpp/...` provider namespace
   - write `models.providers.llamacpp.baseUrl` with `/v1`
   - generate both `local` and `llamacpp` auth profile entries for local runtime compatibility
   - keep UI-facing auth profile `baseUrl` in bare form
4. Normalize config loading so persisted Custom Local configs reload into UI state as:
   - `provider = "local"`
   - `local_base_url = "http://localhost:8080"`
   - model refs like `local/unsloth/...`
5. Prevent `local_base_url` from leaking into unrelated auth profiles such as `google:default`.
6. Add tests for frontend and Rust round-trip behavior.
6. Run tests and `npm run tauri dev`.

## Constraints
- Keep LM Studio and Ollama behavior unchanged except where shared helpers are required.
- Do not widen scope beyond the Custom Local provider contract.
