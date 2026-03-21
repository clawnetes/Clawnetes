import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import StepMaintenance from "../StepMaintenance";
import { WizardContext } from "../../../context/WizardContext";
import { INITIAL_WIZARD_STATE } from "../../../hooks/useWizardState";

describe("StepMaintenance", () => {
  it("requests uninstall confirmation instead of uninstalling immediately", async () => {
    const user = userEvent.setup();
    const handleMaintenanceAction = vi.fn();
    const onRequestUninstall = vi.fn();

    render(
      <WizardContext.Provider
        value={{
          state: {
            ...INITIAL_WIZARD_STATE,
            selectedMaint: "uninstall",
            loading: false,
          },
          dispatch: vi.fn(),
        }}
      >
        <StepMaintenance
          handleMaintenanceAction={handleMaintenanceAction}
          onRequestUninstall={onRequestUninstall}
          loadExistingConfig={vi.fn().mockResolvedValue(false)}
          formatSshError={(error) => error}
        />
      </WizardContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Confirm Action" }));

    expect(onRequestUninstall).toHaveBeenCalledTimes(1);
    expect(handleMaintenanceAction).not.toHaveBeenCalledWith("uninstall");
  });
});
