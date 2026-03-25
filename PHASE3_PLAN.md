# Phase 3: Right Panel Architecture + Agent Display

## Plan

1. [x] Read all current files to understand codebase
2. [x] Create `src/context/ChatPanelContext.ts` - panel state context
3. [x] Create `src/components/panel/RightPanel.tsx` - collapsible panel shell
4. [x] Update `src/components/chat/ChatHeader.tsx` - model badge + panel toggle
5. [x] Update `src/components/chat/ChatSidebar.tsx` - panel integration on Configure
6. [x] Update `src/components/chat/ChatShell.tsx` - panel state, context provider, RightPanel, grid
7. [x] Update `src/App.css` - panel-open grid variant + transition
8. [x] Run `npx tsc --noEmit` to verify no type errors
9. [x] Run tests - all 323 tests pass
10. [ ] Run `npm run tauri dev` to validate visually

## Notes
- Preserve all existing data-testid attributes
- Use Tailwind for new components, existing CSS for existing components
- Panel content is placeholder - actual content comes in Phases 4-6
- Keyboard shortcut: Cmd+, (Mac) / Ctrl+, (non-Mac) to toggle panel
- ChatSidebar's Configure button still calls onOpenConfigure (command center) for backwards compat
- The onOpenPanel prop on ChatSidebar is available for future use but not wired to Configure
