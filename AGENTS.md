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
