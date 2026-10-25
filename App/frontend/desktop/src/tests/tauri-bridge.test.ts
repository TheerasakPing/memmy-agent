import { describe, expect, it, vi } from "vitest";
import { installTauriBridge, TAURI_NATIVE_BRIDGE_METHODS, type TauriWindow } from "../tauri-bridge.js";
import { registerNativeTab, releaseNativeTab } from "../native-browser-tab-state.js";

function setup(userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X)") {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (command === "desktop_app_info") return {
      name: "Memmy", version: "1.2.4", platform: "darwin", arch: "arm64",
      isPackaged: false, isWindowsStore: false
    };
    if (command.startsWith("desktop_get_browser_download") || command === "desktop_choose_browser_download_directory" || command === "desktop_reset_browser_download_directory" || command === "desktop_set_browser_ask_before_download") {
      return { directory: null, approvedDirectories: [], askBeforeDownload: args?.enabled === true };
    }
    if (command === "desktop_native_browser_create") return "11111111-1111-4111-8111-111111111110";
    if (command === "desktop_get_browser_sidebar_surface") return null;
    if (command === "desktop_send_browser_sidebar_action") return true;
    if (command === "desktop_get_browser_history" || command === "desktop_get_browser_access_rules") return [];
    if (command === "desktop_install_cli_tools") return {
      ok: true, binDirectory: "/tmp/home/.local/bin",
      installed: [{ name: "memmy-memory", source: "/runtime/Memory/dist/src/cli/index.js",
        target: "/tmp/home/.local/bin/memmy-memory" }],
      pathUpdated: false, profilePaths: []
    };
    if (command === "desktop_restart_memory_service") return {
      ok: true, baseUrl: "http://127.0.0.1:13333"
    };
    if (command === "desktop_export_memory_database") return {
      canceled: false, exportPath: "/tmp/memmy-memory.json", bytes: 61
    };
    if (command === "desktop_export_diagnostics_report") return { canceled: false, exportPath: "/tmp/diagnostics.txt", bytes: 12 };
    if (command === "desktop_save_file") return { canceled: false, filePath: "/tmp/export.txt", bytes: 3 };
    if (command === "desktop_save_image") return { canceled: false, filePath: "/tmp/image.png", bytes: 8 };
    if (command === "desktop_remove_browser_history") return true;
    if (command === "desktop_remove_selected_browser_history") return 1;
    if (command === "desktop_import_legacy_browser_history") return true;
    if (command === "desktop_set_browser_access_rule") return [{ origin: args?.origin, decision: args?.decision }];
    if (command === "desktop_get_native_app_allow_all") return false;
    if (command === "desktop_set_native_app_allow_all") return args?.enabled === true;
    if (command === "desktop_get_browser_allow_all") return { enabled: false, inherited: false, effective: false };
    if (command === "desktop_set_browser_allow_all") return { enabled: args?.enabled === true, inherited: false, effective: args?.enabled === true };
    if (command === "desktop_get_computer_history_permission_session_id") return "11111111-1111-4111-8111-111111111111";
    if (command === "desktop_get_full_disk_access_status") return true;
    if (command === "desktop_guide_memmy_permission") return true;
    if (command === "desktop_get_browser_extension_directory") return "/tmp/browser-extension";
    if (command === "desktop_reveal_browser_extension") return true;
    if (command === "desktop_get_browser_extension_installation") return {
      chrome: { installed: true, enabled: true },
      edge: { installed: null, enabled: null }
    };
    if (command === "desktop_list_installed_browser_extensions") return ["chrome"];
    if (command === "desktop_list_running_external_browsers") return ["chrome"];
    if (command === "desktop_prepare_browser_extension") return {
      status: "browser-opened", directory: "/tmp/browser-extension"
    };
    if (command === "desktop_fullscreen") return { isFullScreen: false };
    if (command === "desktop_get_installation_id") return "00000000-0000-4000-8000-000000000001";
    if (command === "desktop_get_launch_at_login" || command === "desktop_set_launch_at_login") return true;
    if (command === "desktop_select_project_directory") return { canceled: false, path: "/tmp/my-workspace" };
    if (command === "desktop_select_empty_project_directory") return { canceled: true };
    if (command === "desktop_read_workspace_directory") return { rootPath: "/tmp/my-workspace", relativePath: "", entries: [], truncated: false };
    if (command === "desktop_check_for_updates") return { status: "not-configured", currentVersion: "1.2.4" };
    if (command === "desktop_runtime_config") return {
      baseUrl: "http://127.0.0.1:3000", localToken: "native-runtime-token"
    };
    if (command === "desktop_open_external" && args?.address === "file:///secret") {
      throw new Error("external URL scheme is not allowed");
    }
    return undefined;
  });
  const listeners = new Map<string, (event: { payload: any }) => void>();
  const unsubscribe = vi.fn();
  const listen = vi.fn(async (name: string, callback: (event: { payload: any }) => void) => {
    listeners.set(name, callback);
    return unsubscribe;
  });
  const host = {
    navigator: { userAgent },
    __TAURI__: { core: { invoke }, event: { listen } }
  } as unknown as TauriWindow;
  return { host, invoke, listen,
    emit: (name: string, payload: unknown) => listeners.get(name)?.({ payload }),
    emitFullscreen: (value: boolean) => listeners.get("memmy:window-fullscreen-changed")?.({ payload: { isFullScreen: value } }),
    unsubscribe };
}

describe("Tauri 2 bridge - existing React renderer and feature parity gate", () => {
  it("never overwrites the working Electron preload on a normal browser", () => {
    const { host } = setup();
    const legacy = { platform: "darwin", getRuntimeConfig: vi.fn() } as unknown as NonNullable<Window["memmy"]>;
    host.memmy = legacy;
    expect(installTauriBridge(host)).toBe(false);
    expect(host.memmy).toBe(legacy);
    expect(installTauriBridge({ navigator: host.navigator } as TauriWindow)).toBe(false);
  });

  it("passes native operations into named Rust commands with their arguments", async () => {
    const { host, invoke } = setup();
    expect(installTauriBridge(host)).toBe(true);
    const api = host.memmy!;
    expect(api.platform).toBe("darwin");
    expect(await api.getAppInfo()).toMatchObject({ version: "1.2.4", platform: "darwin" });
    expect(await api.getRuntimeConfig()).toMatchObject({ localToken: "native-runtime-token" });
    const onGatewayStartupIssue = vi.fn();
    const stopGatewayStartupIssue = api.onAgentGatewayStartupIssue!(onGatewayStartupIssue);
    stopGatewayStartupIssue();
    expect(await api.checkForUpdates()).toMatchObject({ status: "not-configured" });
    const native = api as unknown as import("../native-browser-adapter.js").NativeBrowserBridge;
    const rect = { x: 12, y: 80, width: 440, height: 320, visible: true };
    const nativeId = await native.nativeBrowserCreate("https://example.org", rect);
    expect(nativeId).toBe("11111111-1111-4111-8111-111111111110");
    expect(invoke).toHaveBeenCalledWith("desktop_native_browser_create", {
      initialUrl: "https://example.org", bounds: rect
    });
    await native.nativeBrowserBounds(nativeId, { ...rect, visible: false });
    expect(invoke).toHaveBeenCalledWith("desktop_native_browser_bounds", {
      id: nativeId, bounds: { ...rect, visible: false }
    });
    await native.nativeBrowserAction(nativeId, "reload");
    expect(invoke).toHaveBeenCalledWith("desktop_native_browser_action", {
      id: nativeId, action: "reload", url: undefined
    });
    await native.nativeBrowserDestroy(nativeId);
    expect(invoke).toHaveBeenCalledWith("desktop_native_browser_destroy", { id: nativeId });
    expect(await api.getBrowserSidebarSurface?.("session-main")).toBeNull();
    expect(await api.sendBrowserSidebarAction?.("session-main", { action: "reload" })).toBe(true);
    expect(invoke).toHaveBeenCalledWith("desktop_send_browser_sidebar_action", {
      sessionKey: "session-main", action: { action: "reload" }
    });
    expect(await api.getBrowserHistory()).toEqual([]);
    expect(await api.getBrowserAccessRules()).toEqual([]);
    expect(await api.getBrowserDownloadSettings()).toEqual({directory:null,approvedDirectories:[],askBeforeDownload:false});
    expect(await api.chooseBrowserDownloadDirectory()).toMatchObject({directory:null});
    expect(await api.resetBrowserDownloadDirectory()).toMatchObject({directory:null});
    expect((await api.setBrowserAskBeforeDownload(true)).askBeforeDownload).toBe(true);
    expect(await api.importLegacyBrowserHistory([{url:"https://example.com",title:"Example",visitedAt:1}])).toBe(true);
    expect(await api.removeBrowserHistory("https://example.com")).toBe(true);
    expect(await api.removeSelectedBrowserHistory(["https://example.com"])).toBe(1);
    expect(await api.setBrowserAccessRule("https://example.com", "allow")).toEqual([{origin:"https://example.com",decision:"allow"}]);
    expect(invoke).toHaveBeenCalledWith("desktop_set_browser_access_rule", {origin:"https://example.com",decision:"allow"});
    await api.openExternal("https://memmy.bot/");
    await api.openMailto("mailto:team@example.com");
    expect(await api.getComputerHistoryPermissionSessionId?.()).toBe("11111111-1111-4111-8111-111111111111");
    api.sendAnalyticsClientId({
      clientId: "123.456", appEnv: "prod", appEdition: "intl"
    });
    expect(invoke).toHaveBeenCalledWith("desktop_send_analytics_client_id", {
      payload: { clientId: "123.456", appEnv: "prod", appEdition: "intl" }
    });
    expect(await api.installCliTools()).toEqual({
      ok: true, binDirectory: "/tmp/home/.local/bin",
      installed: [{ name: "memmy-memory", source: "/runtime/Memory/dist/src/cli/index.js",
        target: "/tmp/home/.local/bin/memmy-memory" }],
      pathUpdated: false, profilePaths: []
    });
    expect(invoke).toHaveBeenCalledWith("desktop_install_cli_tools", undefined);
    expect(await api.restartMemoryService()).toEqual({
      ok: true, baseUrl: "http://127.0.0.1:13333"
    });
    expect(invoke).toHaveBeenCalledWith("desktop_restart_memory_service", undefined);
    expect(await api.exportMemoryDatabase()).toEqual({
      canceled: false, exportPath: "/tmp/memmy-memory.json", bytes: 61
    });
    expect(invoke).toHaveBeenCalledWith("desktop_export_memory_database", undefined);
    expect(await api.getFullDiskAccessStatus?.()).toBe(true);
    expect(await api.guideMemmyPermission?.("accessibility")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("desktop_guide_memmy_permission", {
      permission: "accessibility"
    });
    await api.restartForComputerHistoryPermissions?.();
    expect(invoke).toHaveBeenCalledWith("desktop_restart_for_computer_history_permissions", undefined);
    expect(await api.getBrowserExtensionDirectory()).toBe("/tmp/browser-extension");
    expect(await api.revealBrowserExtension()).toBe(true);
    expect(await api.getBrowserExtensionInstallation?.()).toEqual({
      chrome: { installed: true, enabled: true }, edge: { installed: null, enabled: null }
    });
    expect(await api.listInstalledBrowserExtensions?.()).toEqual(["chrome"]);
    expect(await api.listRunningExternalBrowsers?.()).toEqual(["chrome"]);
    expect(await api.prepareBrowserExtension?.("chrome", false)).toEqual({
      status: "browser-opened", directory: "/tmp/browser-extension"
    });
    expect(invoke).toHaveBeenCalledWith("desktop_prepare_browser_extension", {
      browser: "chrome", revealFolder: false
    });
    expect(await api.getMicrophoneAccessStatus()).toBe("unsupported");
    expect(await api.requestMicrophoneAccess()).toBe("unsupported");
    await api.openComputerHistoryMarkdown("/private/data/computer-history/histories/summary.md");
    expect(invoke).toHaveBeenCalledWith("desktop_open_computer_history_markdown", {
      filePath: "/private/data/computer-history/histories/summary.md"
    });
    expect(await api.saveFile({ url: "https://example.test/file", name: "export.txt", data: new Uint8Array([1, 2, 3]) })).toEqual({
      canceled: false, filePath: "/tmp/export.txt", bytes: 3
    });
    expect(invoke).toHaveBeenCalledWith("desktop_save_file", {
      request: { url: "https://example.test/file", name: "export.txt", data: [1, 2, 3] }
    });
    await api.copyImageToClipboard({ url: "https://example.test/image.png", data: new Uint8Array([1, 2]) });
    expect(invoke).toHaveBeenCalledWith("desktop_copy_image_to_clipboard", {
      request: { url: "https://example.test/image.png", data: [1, 2] }
    });
    expect(await api.exportDiagnosticsReport()).toEqual({
      canceled: false, exportPath: "/tmp/diagnostics.txt", bytes: 12
    });
    await api.saveImage({ url: "https://example.test/image.png", data: new Uint8Array([137,80,78,71,13,10,26,10]) });
    expect(invoke).toHaveBeenCalledWith("desktop_save_image", {
      request: { url: "https://example.test/image.png", data: [137,80,78,71,13,10,26,10] }
    });
    expect(await api.getMainWindowFullScreen()).toMatchObject({ isFullScreen: false });
    await api.completeMainWindowAction({ id: "00000000-0000-4000-8000-000000000001", resolution: "minimize" });
    await api.notifyTaskDone({ title: "Finished", body: "Agent completed", silent: true });
    await api.notifyUpdateAvailable({ title: "Update", body: "New build", silent: false });
    const rule = { pattern: "https://example.org", access: "ask", downloads: "block", uploads: "ask", fullCdp: "block" } as const;
    await api.getBrowserUseSitePolicies?.();
    await api.upsertBrowserUseSitePolicy?.(rule);
    await api.removeBrowserUseSitePolicy?.("https://example.org");
    expect(invoke).toHaveBeenCalledWith("desktop_upsert_browser_use_site_policy", { rule });
    expect(invoke).toHaveBeenCalledWith("desktop_remove_browser_use_site_policy", { pattern: "https://example.org" });
    expect(await api.getNativeAppAllowAll?.()).toBe(false);
    expect(await api.setNativeAppAllowAll?.(true)).toBe(true);
    expect(await api.getBrowserAllowAll?.()).toEqual({ enabled: false, inherited: false, effective: false });
    expect(await api.setBrowserAllowAll?.(true)).toEqual({ enabled: true, inherited: false, effective: true });
    expect(invoke).toHaveBeenCalledWith("desktop_set_native_app_allow_all", { enabled: true });
    expect(invoke).toHaveBeenCalledWith("desktop_set_browser_allow_all", { enabled: true });
    await api.setLaunchAtLogin(true);
    expect(await api.getLaunchAtLogin()).toBe(true);
    expect(await api.getInstallationId()).toMatch(/00000000-0000/);
    expect(await api.selectProjectDirectory()).toEqual({ canceled: false, path: "/tmp/my-workspace" });
    expect(await api.selectEmptyProjectDirectory()).toEqual({ canceled: true });
    expect(await api.readWorkspaceDirectory("/tmp/my-workspace")).toMatchObject({ entries: [], truncated: false });
    await api.writeWorkspaceFile("/tmp/my-workspace", "/tmp/my-workspace/readme.md", "example");
    await api.setPetWindow(true);
    await api.hidePetWindow();
    await api.setMenuBarIcon(true);
    api.setComputerHistoryTrayIndicator?.({enabled:true, recording:true});
    expect(invoke).toHaveBeenCalledWith("desktop_set_menu_bar_icon",{enabled:true});
    api.syncPetWindowLayout({width:160,height:160,mascotOffsetX:0,mascotOffsetY:0});
    api.startPetWindowDrag({ clientX: 12, clientY: 13 });
    api.movePetWindow({ clientX: 42, clientY: 40 });
    api.stopPetWindowDrag();
    expect(invoke).toHaveBeenCalledWith("desktop_start_pet_window_drag", { pointer: { clientX: 12, clientY: 13 } });
    expect(invoke).toHaveBeenCalledWith("desktop_move_pet_window", { pointer: { clientX: 42, clientY: 40 } });
    expect(invoke).toHaveBeenCalledWith("desktop_stop_pet_window_drag", undefined);
    expect(invoke).toHaveBeenCalledWith("desktop_set_pet_window", { enabled:true, target:undefined });
    expect(invoke).toHaveBeenCalledWith("desktop_write_workspace_file", {
      rootPath: "/tmp/my-workspace", filePath: "/tmp/my-workspace/readme.md", contents: "example"
    });
    expect(invoke).toHaveBeenCalledWith("desktop_notify_task_done", {
      payload: { title: "Finished", body: "Agent completed", silent: true }
    });
    expect(invoke).toHaveBeenCalledWith("desktop_set_launch_at_login", { enabled: true });
    expect(invoke).toHaveBeenCalledWith("desktop_open_external", { address: "https://memmy.bot/" });
    expect(invoke).toHaveBeenCalledWith("desktop_complete_window_action", { responseId: "00000000-0000-4000-8000-000000000001", resolution: "minimize" });
    await expect(api.openExternal("file:///secret")).rejects.toThrow(/not allowed/);
  });

  it("bridges native fullscreen changes to the existing React window listener", async () => {
    const { host, listen, emitFullscreen, unsubscribe } = setup();
    installTauriBridge(host);
    const callback = vi.fn();
    const stop = host.memmy!.onMainWindowFullScreenChanged(callback);
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith("memmy:window-fullscreen-changed", expect.any(Function));
    emitFullscreen(true);
    expect(callback).toHaveBeenCalledWith({ isFullScreen: true });
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("supports real named pet route and main close policy event subscriptions", async () => {
    const { host, listen, emit, unsubscribe, invoke } = setup();
    installTauriBridge(host);
    const route = vi.fn();
    const action = vi.fn();
    const browserPopup = vi.fn();
    const stopBrowserPopup = host.memmy!.onEmbeddedBrowserOpen!(browserPopup);
    const stopRoute = host.memmy!.onRouteTargetRequest(route);
    const stopAction = host.memmy!.onMainWindowActionRequest(action);
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith("memmy:route-target-request", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("memmy:main-window-action-request", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("memmy:browser:open-url", expect.any(Function));
    emit("memmy:browser:open-url", { url: "https://example.org/popup" });
    emit("memmy:browser:open-url", { url: "javascript:alert(1)" });
    emit("memmy:browser:open-url", { url: "https://x:y@example.org/private" });
    expect(browserPopup).toHaveBeenCalledExactlyOnceWith("https://example.org/popup");
    emit("memmy:route-target-request", { route: "/settings", hash: "pet-avatar" });
    emit("memmy:main-window-action-request", { id: "00000000-0000-4000-8000-000000000001", action: "close" });
    expect(route).toHaveBeenCalledWith({ route: "/settings", hash: "pet-avatar" });
    expect(action).toHaveBeenCalledWith({ id: "00000000-0000-4000-8000-000000000001", action: "close" });
    await host.memmy!.completeMainWindowAction({ id: "00000000-0000-4000-8000-000000000001", resolution: "pet" });
    expect(invoke).toHaveBeenCalledWith("desktop_complete_window_action", {
      responseId: "00000000-0000-4000-8000-000000000001", resolution: "pet"
    });
    stopRoute();
    stopAction();
    stopBrowserPopup();
    emit("memmy:browser:open-url", { url: "https://example.org/too-late" });
    expect(browserPopup).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });

  it("routes scoped native tab lifecycle without claiming an Agent browser session", () => {
    const { host } = setup();
    installTauriBridge(host);
    const selected = vi.fn();
    const handle = registerNativeTab(selected);
    const closed = vi.fn();
    const stop = host.memmy!.onEmbeddedBrowserClose!(closed);
    host.memmy!.selectEmbeddedBrowserTab!(handle);
    expect(selected).toHaveBeenCalledTimes(1);
    host.memmy!.selectEmbeddedBrowserTab!(0);
    host.memmy!.selectEmbeddedBrowserTab!(-1);
    expect(selected).toHaveBeenCalledTimes(1);
    releaseNativeTab(handle);
    expect(closed).toHaveBeenCalledExactlyOnceWith(handle);
    stop();
    const next = registerNativeTab(selected);
    releaseNativeTab(next);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("replays a validated Agent Gateway issue to listeners registered after bootstrap", async () => {
    const { host, invoke } = setup();
    invoke.mockImplementation(async (command: string) => {
      if (command === "desktop_runtime_config") return {
        baseUrl: "http://127.0.0.1:3000", localToken: "native-token",
        agentGateway: { startupIssue: "model_config_invalid" }
      };
      return undefined;
    });
    installTauriBridge(host);
    await host.memmy!.getRuntimeConfig();
    const callback = vi.fn();
    const stop = host.memmy!.onAgentGatewayStartupIssue!(callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith("model_config_invalid");
    stop();
  });

  it("subscribes to real browser global approval events and cleans up listeners", async () => {
    const { host, listen, emit, unsubscribe } = setup();
    installTauriBridge(host);
    const onChange = vi.fn();
    const stop = host.memmy!.onBrowserAllowAllChanged!(onChange);
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith("memmy:browser-allow-all:changed", expect.any(Function));
    emit("memmy:browser-allow-all:changed", { enabled: true, inherited: false, effective: true });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ enabled: true, inherited: false, effective: true });
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not pretend unsupported native features work", () => {
    const { host } = setup();
    installTauriBridge(host);
    expect(TAURI_NATIVE_BRIDGE_METHODS.length).toBe(78);
    expect(host.memmy?.installCliTools).toBeTypeOf("function");
    expect(host.memmy?.guideMemmyPermission).toBeTypeOf("function");
    expect(host.memmy?.exportMemoryDatabase).toBeTypeOf("function");
  });
});
