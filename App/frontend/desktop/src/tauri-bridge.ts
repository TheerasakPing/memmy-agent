/**
 * Tauri v2 native boundary for the existing React renderer.
 *
 * No CSS, router, tab or page has been forked: the same main.tsx mounts on
 * Electron (unchanged bridge) or Tauri (narrow typed Rust commands). Missing
 * native capabilities are intentionally absent, not silently "successful".
 * Every missing contract is tracked in tauri-parity-manifest.json.
 */
interface TauriCore {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriGlobal {
  core: TauriCore;
}

export type TauriWindow = Window & { __TAURI__?: TauriGlobal };

export const TAURI_NATIVE_BRIDGE_METHODS = [
  "notifyRendererReady",
  "getRuntimeConfig",
  "getAppInfo",
  "checkForUpdates",
  "openExternal",
  "openMailto",
  "getMainWindowFullScreen",
  "completeMainWindowAction",
  "notifyTaskDone",
  "notifyUpdateAvailable",
  "getInstallationId",
  "getLaunchAtLogin",
  "setLaunchAtLogin"
] as const;

function desktopPlatform(userAgent: string): string {
  if (/windows/i.test(userAgent)) return "win32";
  if (/macintosh|mac os/i.test(userAgent)) return "darwin";
  return "linux";
}

/** Installs only in a real Tauri webview; never replaces the legacy preload. */
export function installTauriBridge(host: TauriWindow): boolean {
  const tauri = host.__TAURI__;
  if (!tauri?.core || typeof tauri.core.invoke !== "function") return false;
  if (host.memmy) return false;

  const invoke = <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
    tauri.core.invoke<T>(command, args);
  // This is deliberately a partial migration of the *existing* bridge.
  // Unported optional methods are absent so their UI controls can gate off;
  // R2/R5 release gates require full contract parity before shipping.
  const bridge = {
    platform: desktopPlatform(host.navigator.userAgent),
    osRelease: "",
    notifyRendererReady(): void {
      // Tauri's webview is ready by the time this React entrypoint executes.
    },
    getRuntimeConfig: () => invoke("desktop_runtime_config"),
    getAppInfo: () => invoke<NonNullable<Window["memmy"]> extends { getAppInfo(): Promise<infer T> } ? T : unknown>("desktop_app_info"),
    checkForUpdates: () => invoke("desktop_check_for_updates"),
    getInstallationId: () => invoke<string>("desktop_get_installation_id"),
    getInstallationId: () => invoke<string>("desktop_get_installation_id"),
    getLaunchAtLogin: () => invoke<boolean>("desktop_get_launch_at_login"),
    setLaunchAtLogin: (enabled: boolean) => invoke<boolean>("desktop_set_launch_at_login", { enabled }),
    notifyTaskDone: (payload: { title: string; body: string; silent: boolean; deliveryId?: string }) =>
      invoke<void>("desktop_notify_task_done", { payload }),
    notifyUpdateAvailable: (payload: { title: string; body: string; silent: boolean }) =>
      invoke<void>("desktop_notify_update_available", { payload }),
    selectProjectDirectory: () => invoke<{ canceled: boolean; path?: string }>("desktop_select_project_directory"),
    selectEmptyProjectDirectory: () => invoke<{ canceled: boolean; path?: string }>("desktop_select_empty_project_directory"),
    openExternal: (url: string) => invoke<void>("desktop_open_external", { address: url }),
    openMailto: (url: string) => invoke<void>("desktop_open_external", { address: url }),
    notifyTaskDone: (payload: { title: string; body: string; silent: boolean }) =>
      invoke<void>("desktop_notify_task_done", { payload }),
    notifyUpdateAvailable: (payload: { title: string; body: string; silent: boolean }) =>
      invoke<void>("desktop_notify_update_available", { payload }),
    getInstallationId: () => invoke<string>("desktop_get_installation_id"),
    getLaunchAtLogin: () => invoke<boolean>("desktop_get_launch_at_login"),
    setLaunchAtLogin: (enabled: boolean) => invoke<boolean>("desktop_set_launch_at_login", { enabled }),
    getMainWindowFullScreen: () => invoke<{ isFullScreen: boolean }>("desktop_fullscreen"),
    completeMainWindowAction: (response: { id: string; resolution: "close" | "hide" | "minimize" | "pet" | "quit" }) =>
      invoke<void>("desktop_complete_window_action", { resolution: response.resolution })
  } as unknown as NonNullable<Window["memmy"]>;
  host.memmy = bridge;
  return true;
}

if (typeof window !== "undefined") {
  installTauriBridge(window as TauriWindow);
}
