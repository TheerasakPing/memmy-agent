/**
 * Tauri v2 native boundary for the existing React renderer.
 *
 * No CSS, router, tab or page has been forked: the same main.tsx mounts on
 * Electron (unchanged bridge) or Tauri (narrow typed Rust commands). Missing
 * native capabilities are intentionally absent, not silently "successful".
 * Every missing contract is tracked in tauri-parity-manifest.json.
 */
import { getNativeMicrophoneAccessStatus, requestNativeMicrophoneAccess } from "./native-microphone-permissions.js";

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
  "onAgentGatewayStartupIssue",
  "getAppInfo",
  "getLogLevel",
  "setLogLevel",
  "openLogsDirectory",
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
  "movePetWindow",
  "stopPetWindowDrag",
  "setMenuBarIcon",
  "setComputerHistoryTrayIndicator",
  "openExternal",
  "openMailto",
  "saveFile",
  "saveImage",
  "copyImageToClipboard",
  "exportDiagnosticsReport",
  "getComputerHistoryPermissionSessionId",
  "getFullDiskAccessStatus",
  "openComputerHistoryMarkdown",
  "getBrowserExtensionDirectory",
  "revealBrowserExtension",
  "prepareBrowserExtension",
  "getBrowserExtensionInstallation",
  "listInstalledBrowserExtensions",
  "listRunningExternalBrowsers",
  "getMicrophoneAccessStatus",
  "requestMicrophoneAccess",
  "getBrowserSidebarSurface",
  "sendBrowserSidebarAction",
  "onBrowserSidebarSurface",
  "getBrowserHistory",
  "importLegacyBrowserHistory",
  "removeBrowserHistory",
  "removeSelectedBrowserHistory",
  "getBrowserDownloadSettings",
  "chooseBrowserDownloadDirectory",
  "resetBrowserDownloadDirectory",
  "setBrowserAskBeforeDownload",
  "getBrowserAccessRules",
  "setBrowserAccessRule",
  "getBrowserUseSitePolicies",
  "upsertBrowserUseSitePolicy",
  "removeBrowserUseSitePolicy",
  "getNativeAppAllowAll",
  "setNativeAppAllowAll",
  "getBrowserAllowAll",
  "setBrowserAllowAll",
  "onBrowserAllowAllChanged",
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
  type GatewayIssue = "model_config_invalid";
  const startupIssues = new Set<(issue: GatewayIssue) => void>();
  let lastStartupIssue: GatewayIssue | undefined;
  const publishStartupIssue = (issue: unknown) => {
    if (issue !== "model_config_invalid") return;
    lastStartupIssue = issue;
    for (const listener of startupIssues) listener(issue);
  };
  // Subscribe before invoking the startup runtime to prevent losing an early event.
  if (tauri.event?.listen) {
    void tauri.event.listen("memmy:agent-gateway-startup-issue", (event) => publishStartupIssue(event.payload));
  }
  const bridge = {
    platform: desktopPlatform(host.navigator.userAgent),
    osRelease: "",
    notifyRendererReady(): void {
      // The webview exists before this React entrypoint mounts.
    },
    getRuntimeConfig: async () => {
      const config = await invoke<{ agentGateway?: { startupIssue?: GatewayIssue } }>("desktop_runtime_config");
      publishStartupIssue(config?.agentGateway?.startupIssue);
      return config;
    },
    onAgentGatewayStartupIssue: (callback: (issue: GatewayIssue) => void) => {
      startupIssues.add(callback);
      if (lastStartupIssue) callback(lastStartupIssue);
      return () => { startupIssues.delete(callback); };
    },
    exportDiagnosticsReport: () =>
      invoke<{ canceled: true } | { canceled: false; exportPath: string; bytes: number }>(
        "desktop_export_diagnostics_report"),
    getComputerHistoryPermissionSessionId: () =>
      invoke<string>("desktop_get_computer_history_permission_session_id"),
    getFullDiskAccessStatus: () => invoke<boolean>("desktop_get_full_disk_access_status"),
    getBrowserExtensionDirectory: () => invoke<string | null>("desktop_get_browser_extension_directory"),
    revealBrowserExtension: () => invoke<boolean>("desktop_reveal_browser_extension"),
    getBrowserExtensionInstallation: () =>
      invoke<Record<"chrome" | "edge", { installed: boolean | null; enabled: boolean | null }>>(
        "desktop_get_browser_extension_installation"),
    listInstalledBrowserExtensions: () =>
      invoke<Array<"chrome" | "edge">>("desktop_list_installed_browser_extensions"),
    listRunningExternalBrowsers: () =>
      invoke<Array<"chrome" | "edge"> | null>("desktop_list_running_external_browsers"),
    prepareBrowserExtension: (browser: "chrome" | "edge", revealFolder = true) =>
      invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["prepareBrowserExtension"]>>>>(
        "desktop_prepare_browser_extension", { browser, revealFolder }),
    getMicrophoneAccessStatus: () => getNativeMicrophoneAccessStatus(host.navigator),
    requestMicrophoneAccess: () => requestNativeMicrophoneAccess(host.navigator),
    openComputerHistoryMarkdown: (filePath: string) =>
      invoke<void>("desktop_open_computer_history_markdown", { filePath }),
    getLogLevel: () => invoke<"error" | "warn" | "info" | "debug">("desktop_get_log_level"),
    setLogLevel: (level: "error" | "warn" | "info" | "debug") => invoke<void>("desktop_set_log_level", { level }),
    openLogsDirectory: () => invoke<void>("desktop_open_logs_directory"),
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
    // Child WebViews live in the original main window; remote origins do not receive native ACL grants.
    nativeBrowserCreate: (initialUrl: string, bounds: import("./native-browser-adapter.js").NativeBrowserBounds) =>
      invoke<string>("desktop_native_browser_create", { initialUrl, bounds }),
    nativeBrowserBounds: (id: string, bounds: import("./native-browser-adapter.js").NativeBrowserBounds) =>
      invoke<void>("desktop_native_browser_bounds", { id, bounds }),
    nativeBrowserAction: (id: string, action: "navigate" | "reload" | "back" | "forward", url?: string) =>
      invoke<void>("desktop_native_browser_action", { id, action, url }),
    nativeBrowserDestroy: (id: string) => invoke<void>("desktop_native_browser_destroy", { id }),
    onNativeBrowserEvent: (callback: (value: import("./native-browser-adapter.js").NativeBrowserMessage) => void) => {
      const listen = tauri.event?.listen;
      if (!listen) return Promise.reject(new Error("Tauri native browser event bridge unavailable"));
      return listen<import("./native-browser-adapter.js").NativeBrowserMessage>(
        "memmy:native-browser:event", event => callback(event.payload));
    },
    getBrowserSidebarSurface: (sessionKey: string) =>
      invoke<import("@memmy/local-api-contracts").ComputerUseSurfaceMessage | null>(
        "desktop_get_browser_sidebar_surface", { sessionKey }),
    sendBrowserSidebarAction: (sessionKey: string, action:
      Pick<import("@memmy/local-api-contracts").ComputerUseSurfaceAction,
        "action" | "x" | "y" | "deltaY" | "key" | "url">) =>
      invoke<boolean>("desktop_send_browser_sidebar_action", { sessionKey, action }),
    onBrowserSidebarSurface: (
      callback: (message: import("@memmy/local-api-contracts").ComputerUseSurfaceMessage) => void
    ) => {
      let active = true;
      let stop: (() => void) | undefined;
      if (tauri.event?.listen) void tauri.event.listen<
        import("@memmy/local-api-contracts").ComputerUseSurfaceMessage
      >("memmy:browser-sidebar:surface", ({ payload }) => {
        if (active) callback(payload);
      }).then(unsubscribe => {
        if (active) stop = unsubscribe;
        else unsubscribe();
      }).catch(() => undefined);
      return () => { active = false; stop?.(); };
    },
    getBrowserHistory: () => invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["getBrowserHistory"]>>>>("desktop_get_browser_history"),
    importLegacyBrowserHistory: (entries: Parameters<NonNullable<NonNullable<Window["memmy"]>["importLegacyBrowserHistory"]>>[0]) =>
      invoke<boolean>("desktop_import_legacy_browser_history", { entries }),
    removeBrowserHistory: (url: string) => invoke<boolean>("desktop_remove_browser_history", { url }),
    removeSelectedBrowserHistory: (urls: string[]) => invoke<number>("desktop_remove_selected_browser_history", { urls }),
    getBrowserDownloadSettings: () => invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["getBrowserDownloadSettings"]>>>>("desktop_get_browser_download_settings"),
    chooseBrowserDownloadDirectory: () => invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["chooseBrowserDownloadDirectory"]>>>>("desktop_choose_browser_download_directory"),
    resetBrowserDownloadDirectory: () => invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["resetBrowserDownloadDirectory"]>>>>("desktop_reset_browser_download_directory"),
    setBrowserAskBeforeDownload: (enabled: boolean) => invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["setBrowserAskBeforeDownload"]>>>>("desktop_set_browser_ask_before_download", { enabled }),
    getBrowserAccessRules: () => invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["getBrowserAccessRules"]>>>>("desktop_get_browser_access_rules"),
    setBrowserAccessRule: (origin: string, decision: "allow" | "deny" | "ask") =>
      invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["setBrowserAccessRule"]>>>>("desktop_set_browser_access_rule", { origin, decision }),
    getBrowserUseSitePolicies: () =>
      invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["getBrowserUseSitePolicies"]>>>>("desktop_get_browser_use_site_policies"),
    upsertBrowserUseSitePolicy: (rule: Parameters<NonNullable<NonNullable<Window["memmy"]>["upsertBrowserUseSitePolicy"]>>[0]) =>
      invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["upsertBrowserUseSitePolicy"]>>>>("desktop_upsert_browser_use_site_policy", { rule }),
    removeBrowserUseSitePolicy: (pattern: string) =>
      invoke<Awaited<ReturnType<NonNullable<NonNullable<Window["memmy"]>["removeBrowserUseSitePolicy"]>>>>("desktop_remove_browser_use_site_policy", { pattern }),
    getNativeAppAllowAll: () => invoke<boolean>("desktop_get_native_app_allow_all"),
    setNativeAppAllowAll: (enabled: boolean) => invoke<boolean>("desktop_set_native_app_allow_all", { enabled }),
    getBrowserAllowAll: () =>
      invoke<import("@memmy/local-api-contracts").BrowserAllowAllState>("desktop_get_browser_allow_all"),
    setBrowserAllowAll: (enabled: boolean) =>
      invoke<import("@memmy/local-api-contracts").BrowserAllowAllState>("desktop_set_browser_allow_all", { enabled }),
    onBrowserAllowAllChanged: (callback: (value: import("@memmy/local-api-contracts").BrowserAllowAllState) => void) => {
      const listen = tauri.event?.listen;
      if (!listen) throw new Error("Tauri browser approval event bridge unavailable");
      let removed = false;
      let unsubscribe: (() => void) | undefined;
      void listen<import("@memmy/local-api-contracts").BrowserAllowAllState>(
        "memmy:browser-allow-all:changed", (event) => callback(event.payload)
      ).then((stop) => { if (removed) stop(); else unsubscribe = stop; });
      return () => { removed = true; unsubscribe?.(); };
    },
    openExternal: (url: string) => invoke<void>("desktop_open_external", { address: url }),
    openMailto: (url: string) => invoke<void>("desktop_open_external", { address: url }),
    // Typed arrays must be JSON arrays (not index-keyed objects) at Tauri's IPC boundary.
    // URL-only requests fail explicitly until an authenticated native media fetch is ported.
    saveFile: (request: import("@memmy/desktop-interface").DesktopImageActionRequest) =>
      invoke<import("@memmy/desktop-interface").DesktopImageSaveResult>(
        "desktop_save_file", { request: { ...request, data: request.data ? Array.from(request.data) : undefined } }),
    copyImageToClipboard: (request: import("@memmy/desktop-interface").DesktopImageActionRequest) =>
      invoke<void>("desktop_copy_image_to_clipboard", {
        request: { ...request, data: request.data ? Array.from(request.data) : undefined }
      }),
    saveImage: (request: import("@memmy/desktop-interface").DesktopImageActionRequest) =>
      invoke<import("@memmy/desktop-interface").DesktopImageSaveResult>(
        "desktop_save_image", { request: { ...request, data: request.data ? Array.from(request.data) : undefined } }),
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
    startPetWindowDrag: (pointer: { clientX: number; clientY: number }) => {
      void invoke<void>("desktop_start_pet_window_drag", { pointer }).catch((error) =>
        console.error("Tauri pet native drag rejected", error));
    },
    movePetWindow: (pointer: { clientX: number; clientY: number }) => {
      void invoke<void>("desktop_move_pet_window", { pointer }).catch((error) =>
        console.error("Tauri pet move rejected", error));
    },
    stopPetWindowDrag: () => {
      void invoke<void>("desktop_stop_pet_window_drag").catch((error) =>
        console.error("Tauri pet drag stop rejected", error));
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
