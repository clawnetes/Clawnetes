import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import StepMaintenance from "../StepMaintenance";
import { WizardContext } from "../../../context/WizardContext";
import { INITIAL_WIZARD_STATE } from "../../../hooks/useWizardState";

describe("StepMaintenance", () => {
  it.each(["repair", "audit", "update", "uninstall"] as const)(
    "requests %s confirmation instead of running immediately",
    async (selectedMaint) => {
    const user = userEvent.setup();
    const handleMaintenanceAction = vi.fn();
    const onRequestConfirmation = vi.fn();

    render(
      <WizardContext.Provider
        value={{
          state: {
            ...INITIAL_WIZARD_STATE,
            selectedMaint,
            loading: false,
          },
          dispatch: vi.fn(),
        }}
      >
        <StepMaintenance
          handleMaintenanceAction={handleMaintenanceAction}
          onRequestConfirmation={onRequestConfirmation}
          loadExistingConfig={vi.fn().mockResolvedValue(false)}
          formatSshError={(error) => error}
        />
      </WizardContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Confirm Action" }));

      expect(onRequestConfirmation).toHaveBeenCalledTimes(1);
      expect(onRequestConfirmation).toHaveBeenCalledWith(selectedMaint);
      expect(handleMaintenanceAction).not.toHaveBeenCalledWith(selectedMaint);
    },
  );
});
