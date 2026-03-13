# Per-Agent Tool Schema Fix Plan

## Objective
- Stop Clawnetes from writing invalid per-agent `tools.agentToAgent` keys into OpenClaw config.
- Keep multi-agent configs valid against OpenClaw `2026.3.12` so gateway restart succeeds.
- Preserve current multi-agent behavior while tightening per-agent tool serialization.

## Implementation Outline
- Remove unsupported `agentToAgent` from the nested per-agent tool payload types in Clawnetes.
- Update the Rust per-agent tools serializer to omit unsupported and empty optional fields instead of writing `null` keys.
- Add regression tests covering per-agent tool JSON shape and absence of `agentToAgent`.
- Validate with `openclaw config validate`, `npm test`, and `npm run tauri dev`.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push after validation succeeds.
