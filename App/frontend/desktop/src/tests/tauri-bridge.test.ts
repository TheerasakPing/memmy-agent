import { describe, expect, it, vi } from "vitest";
import { installTauriBridge, TAURI_NATIVE_BRIDGE_METHODS, type TauriWindow } from "../tauri-bridge.js";

function setup(userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X)") {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (command === "desktop_app_info") return {
      name: "Memmy", version: "1.2.4", platform: "darwin", arch: "arm64",
      isPackaged: false, isWindowsStore: false
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
    expect(await api.checkForUpdates()).toMatchObject({ status: "not-configured" });
    await api.openExternal("https://memmy.bot/");
    await api.openMailto("mailto:team@example.com");
    expect(await api.getMainWindowFullScreen()).toMatchObject({ isFullScreen: false });
    await api.completeMainWindowAction({ id: "00000000-0000-4000-8000-000000000001", resolution: "minimize" });
    await api.notifyTaskDone({ title: "Finished", body: "Agent completed", silent: true });
    await api.notifyUpdateAvailable({ title: "Update", body: "New build", silent: false });
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
    const stopRoute = host.memmy!.onRouteTargetRequest(route);
    const stopAction = host.memmy!.onMainWindowActionRequest(action);
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith("memmy:route-target-request", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("memmy:main-window-action-request", expect.any(Function));
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
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("does not pretend unsupported native features work", () => {
    const { host } = setup();
    installTauriBridge(host);
    expect(TAURI_NATIVE_BRIDGE_METHODS.length).toBe(26);
    expect(host.memmy?.installCliTools).toBeUndefined();
    expect(host.memmy?.movePetWindow).toBeUndefined();
    expect(host.memmy?.exportMemoryDatabase).toBeUndefined();
  });
});
