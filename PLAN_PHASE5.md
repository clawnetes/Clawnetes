# Phase 5: Skills & Integration Hub - Implementation Plan

## Files to Create
1. `/src/presets/skillCategories.ts` - Skill category definitions
2. `/src/components/panel/SkillsPanel.tsx` - Skills management panel
3. `/src/components/panel/IntegrationHubPanel.tsx` - Integration hub panel
4. `/src/components/__tests__/skillsPanel.test.tsx` - SkillsPanel tests
5. `/src/components/__tests__/integrationHubPanel.test.tsx` - IntegrationHubPanel tests

## Files to Modify
1. `/src/components/panel/RightPanel.tsx` - Wire in SkillsPanel and IntegrationHubPanel
2. `/src/components/chat/ChatShell.tsx` - Add activeSkills/serviceKeys props and pass through

## Implementation Order
- [x] 1. Create skillCategories.ts
- [x] 2. Create SkillsPanel.tsx
- [x] 3. Create IntegrationHubPanel.tsx
- [x] 4. Update RightPanel.tsx
- [x] 5. Update ChatShell.tsx
- [x] 6. Write tests for SkillsPanel
- [x] 7. Write tests for IntegrationHubPanel
- [ ] 8. Run tsc --noEmit and vitest run
