import type { ProviderAuthConfig } from "../types";
import type { DeferredOAuthItem } from "./providerAuth";

export interface DeferredOAuthExecutionOptions {
  queue: DeferredOAuthItem[];
  initialProviderAuths: Record<string, ProviderAuthConfig>;
  invokeProviderAuth: (item: DeferredOAuthItem) => Promise<ProviderAuthConfig>;
  onItemStart?: (item: DeferredOAuthItem) => void;
  onItemSuccess?: (item: DeferredOAuthItem, auth: ProviderAuthConfig) => void;
  onItemError?: (item: DeferredOAuthItem, message: string) => void;
  onProviderBusyChange?: (provider: string, busy: boolean) => void;
  onProviderErrorChange?: (provider: string, message: string) => void;
}

export interface DeferredOAuthExecutionResult {
  nextProviderAuths: Record<string, ProviderAuthConfig>;
  successfulItems: DeferredOAuthItem[];
}

export async function executeDeferredOAuthQueue(
  options: DeferredOAuthExecutionOptions,
): Promise<DeferredOAuthExecutionResult> {
  let nextProviderAuths = { ...options.initialProviderAuths };
  const successfulItems: DeferredOAuthItem[] = [];

  for (const item of options.queue) {
    options.onItemStart?.(item);
    options.onProviderBusyChange?.(item.targetProvider, true);
    options.onProviderErrorChange?.(item.targetProvider, "");

    try {
      const result = await options.invokeProviderAuth(item);
      nextProviderAuths = {
        ...nextProviderAuths,
        [item.targetProvider]: result,
      };
      successfulItems.push(item);
      options.onItemSuccess?.(item, result);
    } catch (error) {
      const message = String(error);
      options.onProviderErrorChange?.(item.targetProvider, message);
      options.onItemError?.(item, message);
    } finally {
      options.onProviderBusyChange?.(item.targetProvider, false);
    }
  }

  return {
    nextProviderAuths,
    successfulItems,
  };
}
