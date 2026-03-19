# AGENTS.md

This is an instruction file for AI coding agents (OpenAI Codex, Claude Code, Gemini)

## Clarifications

If the request is not clear, or is ambigious, ask for clarifications before making changes to code.

## Planning

Always make a thorough plan and write it to file. Also track progress on file.

## Test driven development

When adding feautures, always add extensise unit tests.

## Running tests

After implementing a feature, or making code changes, always run tests.
Fix test failures. Do not stop until all tests pass.

## Validating work

Always run `npm run tauri dev` after making code change. If there are issues, fix them based on the output.
Do NOT stop working until all issues are addressed.

## Stability

Whenever changing code, take extra care that code addition or removal does not break working functionality.

## Commiting

If the build is successful, and all the unit tests pass, git commit the changes and git push to the remote branch.

## gstack

For all web browsing, use the `/browse` skill from gstack. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
- `/office-hours` - Brainstorming and idea validation
- `/plan-ceo-review` - CEO/founder-mode plan review
- `/plan-eng-review` - Engineering architecture review
- `/plan-design-review` - Design plan review
- `/design-consultation` - Create a design system
- `/review` - Pre-landing PR review
- `/ship` - Ship workflow (test, review, PR)
- `/browse` - Headless browser for QA and site testing
- `/qa` - QA test and fix bugs
- `/qa-only` - QA report only (no fixes)
- `/design-review` - Visual design QA and polish
- `/setup-browser-cookies` - Import cookies for authenticated testing
- `/retro` - Weekly engineering retrospective
- `/investigate` - Systematic debugging with root cause analysis
- `/document-release` - Post-ship documentation update
- `/codex` - OpenAI Codex second opinion / review
- `/careful` - Safety guardrails for destructive commands
- `/freeze` - Restrict edits to a specific directory
- `/guard` - Full safety mode (careful + freeze)
- `/unfreeze` - Remove edit restrictions
- `/gstack-upgrade` - Upgrade gstack to latest version
