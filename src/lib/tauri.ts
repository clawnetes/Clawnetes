import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

export { invoke, openDialog };

export function openExternal(target: string) {
  return openUrl(target);
}
