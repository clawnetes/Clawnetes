import type { AgentPlatform } from "../platforms/types";
import { createContext, useContext } from "react";
import type { WizardState, WizardAction } from "../hooks/useWizardState";

export interface WizardContextValue {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onSwitchPlatform?: (platform: AgentPlatform) => void;
  onSwitchTargetEnvironment?: (targetEnvironment: "local" | "cloud") => void;
}

export const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within a WizardContext.Provider");
  return ctx;
}
