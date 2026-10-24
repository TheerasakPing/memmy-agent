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
  event?: {
    listen<T>(name: string, callback: (event: { payload: T }) => void): Promise<() => void>;
  };
}

export type TauriWindow = Window & { __TAURI__?: TauriGlobal };

export const TAURI_NATIVE_BRIDGE_METHODS = [
  "notifyRendererReady",
  "getRuntimeConfig",
  "getAppInfo",
  "checkForUpdates",
  "getInstallationId",
  "getLaunchAtLogin",
  "setLaunchAtLogin",
  "notifyTaskDone",
  "notifyUpdateAvailable",
  "selectProjectDirectory",
  "selectEmptyProjectDirectory",
  "readWorkspaceDirectory",
  "writeWorkspaceFile",
  "setPetWindow",
  "hidePetWindow",
  "onRouteTargetRequest",
  "syncPetWindowLayout",
  "startPetWindowDrag",
  "setMenuBarIcon",
  "setComputerHistoryTrayIndicator",
  "openExternal",
  "openMailto",
  "getMainWindowFullScreen",
  "onMainWindowFullScreenChanged",
  "onMainWindowActionRequest",
  "completeMainWindowAction"
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
      // The webview exists before this React entrypoint mounts.
    },
    getRuntimeConfig: () => invoke("desktop_runtime_config"),
    getAppInfo: () => invoke<Awaited<ReturnType<NonNullable<Window["memmy"]>["getAppInfo"]>>>("desktop_app_info"),
    checkForUpdates: () => invoke("desktop_check_for_updates"),
    getInstallationId: () => invoke<string>("desktop_get_installation_id"),
    getLaunchAtLogin: () => invoke<boolean>("desktop_get_launch_at_login"),
    setLaunchAtLogin: (enabled: boolean) => invoke<boolean>("desktop_set_launch_at_login", { enabled }),
    notifyTaskDone: (payload: { title: string; body: string; silent: boolean; deliveryId?: string }) =>
      invoke<void>("desktop_notify_task_done", { payload }),
    notifyUpdateAvailable: (payload: { title: string; body: string; silent: boolean }) =>
      invoke<void>("desktop_notify_update_available", { payload }),
    selectProjectDirectory: () => invoke<{ canceled: boolean; path?: string }>("desktop_select_project_directory"),
    selectEmptyProjectDirectory: () => invoke<{ canceled: boolean; path?: string }>("desktop_select_empty_project_directory"),
    readWorkspaceDirectory: (rootPath: string, relativePath = "") =>
      invoke<Awaited<ReturnType<NonNullable<Window["memmy"]>["readWorkspaceDirectory"]>>>(
        "desktop_read_workspace_directory", { rootPath, relativePath }),
    writeWorkspaceFile: (rootPath: string, filePath: string, contents: string) =>
      invoke<void>("desktop_write_workspace_file", { rootPath, filePath, contents }),
    openExternal: (url: string) => invoke<void>("desktop_open_external", { address: url }),
    openMailto: (url: string) => invoke<void>("desktop_open_external", { address: url }),
    getMainWindowFullScreen: () => invoke<{ isFullScreen: boolean }>("desktop_fullscreen"),
    onMainWindowFullScreenChanged: (callback: (state: { isFullScreen: boolean }) => void) => {
      const listen = tauri.event?.listen;
      if (!listen) {
        // A non-compliant host must fail visibly instead of pretending
        // fullscreen UX updates are supported.
        throw new Error("Tauri event bridge is unavailable");
      }
      let removed = false;
      let unsubscribe: (() => void) | undefined;
      void listen<{ isFullScreen: boolean }>(
        "memmy:window-fullscreen-changed",
        (event) => callback(event.payload)
      ).then((stop) => {
        if (removed) stop();
        else unsubscribe = stop;
      });
      return () => {
        removed = true;
        unsubscribe?.();
      };
    },
    setPetWindow: (enabled: boolean, target?: { route?: string; hash?: string; agentChatId?: string; petIntent?: "user" }) =>
      invoke<void>("desktop_set_pet_window", { enabled, target }),
    hidePetWindow: () => invoke<void>("desktop_hide_pet_window"),
    onRouteTargetRequest: (callback: (target: { route?: string; hash?: string; agentChatId?: string }) => void) => {
      const listen = tauri.event?.listen;
      if (!listen) throw new Error("Tauri route event bridge unavailable");
      let removed = false;
      let unsubscribe: (() => void) | undefined;
      void listen<{ route?: string; hash?: string; agentChatId?: string }>(
        "memmy:route-target-request", (event) => callback(event.payload)
      ).then((stop) => { if (removed) stop(); else unsubscribe = stop; });
      return () => { removed = true; unsubscribe?.(); };
    },
    syncPetWindowLayout: (layout: { width: number; height: number; mascotOffsetX: number; mascotOffsetY: number }) => {
      void invoke<void>("desktop_sync_pet_window_layout", { layout }).catch((error) =>
        console.error("Tauri pet layout rejected", error));
    },
    startPetWindowDrag: (_pointer: { clientX: number; clientY: number }) => {
      void invoke<void>("desktop_start_pet_window_drag").catch((error) =>
        console.error("Tauri pet native drag rejected", error));
    },
    setMenuBarIcon: (enabled: boolean) => invoke<{ enabled: boolean }>("desktop_set_menu_bar_icon", { enabled }),
    setComputerHistoryTrayIndicator: (indicator: { enabled: boolean; recording: boolean }) => {
      void invoke<void>("desktop_set_computer_history_tray_indicator", { indicator }).catch((error) =>
        console.error("Tauri tray indicator rejected", error));
    },
    onMainWindowActionRequest: (callback: (request: { id: string; action: "close" | "minimize" }) => void) => {
      const listen = tauri.event?.listen;
      if (!listen) throw new Error("Tauri main action event bridge unavailable");
      let removed = false;
      let unsubscribe: (() => void) | undefined;
      void listen<{ id: string; action: "close" | "minimize" }>(
        "memmy:main-window-action-request", (event) => callback(event.payload)
      ).then((stop) => { if (removed) stop(); else unsubscribe = stop; });
      return () => { removed = true; unsubscribe?.(); };
    },
    completeMainWindowAction: (response: { id: string; resolution: "close" | "hide" | "minimize" | "pet" | "quit" }) =>
      invoke<void>("desktop_complete_window_action", { responseId: response.id, resolution: response.resolution })
  } as unknown as NonNullable<Window["memmy"]>;
  host.memmy = bridge;
  return true;
}

if (typeof window !== "undefined") {
  installTauriBridge(window as TauriWindow);
}
