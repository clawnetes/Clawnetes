# Themed Title Bar For Chat Shell

## Summary
- Replace the native white window chrome with a custom title bar that matches the selected app theme.
- Keep the title bar consistent across loading, setup, and chat states instead of styling only one screen.
- Preserve draggable window behavior and basic window controls inside the custom chrome.

## Implementation Changes
- Update the Tauri window configuration to disable the native decorated title bar and allow a frontend-owned title bar.
- Add a top-level title-bar component in the app shell with theme-aware styling, draggable behavior, and minimize/maximize/close actions.
- Apply the saved/resolved theme at the app level so the custom title bar and the rest of the UI share the same theme state.
- Extend app/chat tests to cover title-bar rendering and theme synchronization.
- Validate with `npm test` and `npm run tauri dev`.
- If validation succeeds, commit and push the changes.
