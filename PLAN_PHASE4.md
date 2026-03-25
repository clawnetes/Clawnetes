# Phase 4: Agent Management Panel & Model Switcher Panel

## Plan

### 1. Create AgentOverviewPanel.tsx
- Display list of agents with active indicator
- Show model info with ProviderLogo
- Skills count badge
- Add Agent placeholder button
- Props: agents, activeAgentId, onAgentSwitch, modelRef, fallbackModels, skills

### 2. Create ModelSwitcherPanel.tsx
- Display current model prominently
- SearchInput to filter models
- Models grouped by provider with logos
- Radio-style selection with checkmark
- Fallback models section with remove/add
- Props: currentModel, fallbackModels, onModelChange, onFallbacksChange

### 3. Update RightPanel.tsx
- Add props interface (agents, activeAgentId, onAgentSwitch, etc.)
- Replace placeholder content for "agents" and "model" tabs
- Pass through props to child panels

### 4. Update ChatShell.tsx
- Add agentFallbackModels and agentSkills props
- Pass all necessary props down to RightPanel

## Progress
- [x] AgentOverviewPanel.tsx
- [x] ModelSwitcherPanel.tsx
- [x] Update RightPanel.tsx
- [x] Update ChatShell.tsx
- [x] TypeScript validation
- [x] Tests (31 panel tests, 354 total - all passing)
- [x] Production build verified
