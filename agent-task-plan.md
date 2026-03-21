# Fix Reconfigure Sandbox Dropdown Clipping

## Summary
- Fix the `Extra Settings` sandbox dropdown so all sandbox options are visible during reconfigure.
- Remove accordion clipping that truncates dropdown panels inside the advanced settings sections.

## Implementation Changes
- Update accordion container styling in `src/App.css` so dropdown overlays can escape the section bounds.
- Keep the existing section visuals and border radii intact without clipping the dropdown menu.

## Validation
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if validation succeeds.
