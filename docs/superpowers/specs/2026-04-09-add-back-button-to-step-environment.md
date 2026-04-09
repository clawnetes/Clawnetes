# Spec: Add Back Button to StepEnvironment

The user reported a missing "Back" button in the "Target Environment" step (Step 1) of the setup wizard. This step follows the "Agent Platform" selection (Step 0.75).

## Proposed Changes

### 1. `src/components/steps/StepEnvironment.tsx`
- Add a "Back" button to the `button-group` at the bottom of the component.
- The button should set the wizard step to `0.75`.
- Update the step description to be platform-aware (use "OpenClaw" or "Hermes").

## Implementation Plan

1. Modify `src/components/steps/StepEnvironment.tsx`:
    - Get `platform` from `state`.
    - Define `platformLabel`.
    - Update `<h2>` and `<p>` text to use `platformLabel`.
    - Add the "Back" button in the `button-group`.

## Verification Plan

### Automated Tests
- Update `e2e/specs/wizard-flow.e2e.ts` (if it exists and covers this) to verify the back button exists and works.
- Add a unit test or check existing tests in `src/components/steps/__tests__/`.

### Manual Verification
- Navigate to the wizard.
- Select a platform.
- Click "Continue" to reach "Target Environment".
- Verify the "Back" button is present.
- Click "Back" and verify it returns to "Agent Platform".
