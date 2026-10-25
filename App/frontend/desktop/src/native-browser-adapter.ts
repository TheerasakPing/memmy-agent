import { isNativeTabVisible, registerNativeTab, releaseNativeTab } from "./native-browser-tab-state.js";

/** Adapts a real Tauri child WebView to the existing Electron BrowserPanel controls.
 * This is a browser host, not a native Computer Use or arbitrary page IPC grant.
 */
export type NativeBrowserBounds = { x: number; y: number; width: number; height: number; visible: boolean };
export type NativeBrowserMessage = { id: string; kind: "started" | "finished" | "title"; url?: string; title?: string };

export interface NativeBrowserBridge {
  nativeBrowserCreate(initialUrl: string, bounds: NativeBrowserBounds): Promise<string>;
  nativeBrowserBounds(id: string, bounds: NativeBrowserBounds): Promise<void>;
  nativeBrowserAction(id: string, action: "navigate" | "reload" | "back" | "forward", url?: string): Promise<void>;
  nativeBrowserDestroy(id: string): Promise<void>;
  nativeBrowserMarkUserNavigation(id: string): Promise<void>;
  onNativeBrowserEvent(callback: (message: NativeBrowserMessage) => void): Promise<() => void>;
}

export type NativeBrowserView = HTMLElement & {
  getWebContentsId(): number;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
};

export type NativeBrowserAdapter = {
  view: NativeBrowserView;
  mount(): Promise<void>;
  syncBounds(visible: boolean): void;
  destroy(): void;
};

export function nativeBrowserBounds(element: HTMLElement, visible: boolean): NativeBrowserBounds {
  if (!visible) return { x: 0, y: 0, width: 0, height: 0, visible: false };
  const rect = element.getBoundingClientRect();
  const x = Math.min(window.innerWidth, Math.max(0, rect.left));
  const y = Math.min(window.innerHeight, Math.max(0, rect.top));
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  return {
    x, y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
    visible: rect.width >= 16 && rect.height >= 16 && right > x && bottom > y,
  };
}

export function createNativeBrowserAdapter(
  element: HTMLElement, bridge: NativeBrowserBridge, initialUrl: string
): NativeBrowserAdapter {
  let id: string | null = null;
  let nativeUiHandle = 0;
  let starting: Promise<void> | null = null;
  let destroyed = false;
  let visible = false;
  let currentUrl = initialUrl || "about:blank";
  let currentTitle = "";
  const pages: string[] = [currentUrl];
  let pageIndex = 0;
  let unlisten: (() => void) | undefined;
  let pendingUrl: string | null = null;

  const dispatch = (event: string) => element.dispatchEvent(new Event(event));
  const onEvent = (message: NativeBrowserMessage) => {
    if (destroyed || message.id !== id) return;
    if (message.kind === "title") {
      currentTitle = message.title ?? "";
      dispatch("page-title-updated");
    } else {
      if (message.url) {
        currentUrl = message.url;
        if (message.kind === "finished" && pages[pageIndex] !== currentUrl) {
          const previous = pages.lastIndexOf(currentUrl);
          if (previous !== -1) pageIndex = previous;
          else {
            pages.splice(pageIndex + 1);
            pages.push(currentUrl);
            pageIndex = pages.length - 1;
          }
        }
      }
      if (message.kind === "started") dispatch("did-start-loading");
      else {
        dispatch("did-navigate");
        dispatch("did-stop-loading");
      }
    }
  };
  const invoke = async (action: "navigate" | "reload" | "back" | "forward", url?: string) => {
    if (destroyed) throw Error("native browser tab already closed");
    if (!id) {
      if (action === "navigate" && url) { pendingUrl = url; return; }
      throw Error("native browser tab not yet ready");
    }
    await bridge.nativeBrowserAction(id, action, url);
  };
  const view = Object.assign(element, {
    // Ephemeral React-only native tab handle, NOT an Electron guest ID nor
    // an Agent Browser session/target ID.
    getWebContentsId: () => nativeUiHandle,
    loadURL: (url: string) => invoke("navigate", url),
    getURL: () => currentUrl,
    getTitle: () => currentTitle,
    canGoBack: () => pageIndex > 0,
    canGoForward: () => pageIndex + 1 < pages.length,
    goBack: () => { void invoke("back").catch(() => dispatch("did-fail-load")); },
    goForward: () => { void invoke("forward").catch(() => dispatch("did-fail-load")); },
    reload: () => { void invoke("reload").catch(() => dispatch("did-fail-load")); },
  }) as NativeBrowserView;

  async function mount(): Promise<void> {
    if (destroyed) return;
    if (starting) return starting;
    starting = (async () => {
      unlisten = await bridge.onNativeBrowserEvent(onEvent);
      if (destroyed) { unlisten(); return; }
      const requestedOnCreate = pendingUrl ?? currentUrl;
      // A newly created child is never briefly exposed above another selected
      // native guest while its own UI handle is being registered.
      const created = await bridge.nativeBrowserCreate(requestedOnCreate,
        nativeBrowserBounds(element, visible && isNativeTabVisible(0)));
      if (destroyed) {
        await bridge.nativeBrowserDestroy(created);
        return;
      }
      id = created;
      try {
        nativeUiHandle = registerNativeTab(() => {
        if (!destroyed && id) {
          void bridge.nativeBrowserBounds(id, nativeBrowserBounds(element,
            visible && isNativeTabVisible(nativeUiHandle)))
            .catch(() => dispatch("did-fail-load"));
        }
        }, async () => {
          if (!id || destroyed) throw Error("native browser WebView not available");
          await bridge.nativeBrowserMarkUserNavigation(id);
        });
      } catch (error) {
        id = null;
        await bridge.nativeBrowserDestroy(created).catch(() => undefined);
        throw error;
      }
      currentUrl = requestedOnCreate;
      // Reconcile the actual Rust-owned WebView after handle registration.
      if (visible) {
        await bridge.nativeBrowserBounds(created, nativeBrowserBounds(element,
          visible && isNativeTabVisible(nativeUiHandle)));
      }
      const target = pendingUrl;
      pendingUrl = null;
      dispatch("dom-ready");
      if (target && target !== requestedOnCreate) await bridge.nativeBrowserAction(id, "navigate", target);
    })();
    try { await starting; }
    catch (error) { starting = null; unlisten?.(); unlisten = undefined; throw error; }
  }

  const syncBounds = (show: boolean) => {
    visible = show;
    if (!id || destroyed) return;
    void bridge.nativeBrowserBounds(id, nativeBrowserBounds(element,
      show && isNativeTabVisible(nativeUiHandle)))
      .catch(() => dispatch("did-fail-load"));
  };

  const destroy = () => {
    destroyed = true;
    unlisten?.();
    unlisten = undefined;
    if (id) {
      // Emit an actual close only after the Rust-owned WebView reports success.
      // Never tell React the tab closed if the native destroy command rejected.
      const closing = id;
      const handle = nativeUiHandle;
      void bridge.nativeBrowserDestroy(closing).then(() => {
        if (handle) releaseNativeTab(handle);
      }).catch(() => {
        // Cleanup local registry on native close error without forging a close event.
        if (handle) releaseNativeTab(handle, false);
      });
    }
    id = null;
    nativeUiHandle = 0;
  };
  return { view, mount, syncBounds, destroy };
}
