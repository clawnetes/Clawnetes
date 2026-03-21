# Fix Tool Access Dark Mode Contrast

## Summary
- Fix the Tool Access page so section cards, headers, rows, and tags render with correct contrast in dark mode.
- Keep the existing light-mode appearance aligned with the shared theme tokens.

## Implementation Changes
- Replace hardcoded light surfaces in `src/App.css` for the Tool Access editor with theme variables.
- Ensure section headers, rows, tags, and elevated-runtime row inherit dark-mode-friendly panel and border colors.

## Validation
- Run `npm test`.
- Run `npm test`.
- Run `npm run tauri dev`.
- Commit and push if validation succeeds.
