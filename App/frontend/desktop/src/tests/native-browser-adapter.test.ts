// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createNativeBrowserAdapter, nativeBrowserBounds, type NativeBrowserBridge, type NativeBrowserMessage,
} from "../native-browser-adapter.js";
import { selectNativeTab, onNativeTabClosed, markNativeTabUserNavigation } from "../native-browser-tab-state.js";

const make = () => {
  const element = document.createElement("div");
  document.body.append(element);
  Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => ({
    left: 40, top: 110, right: 460, bottom: 410, width: 420, height: 300,
  }) });
  let publish: (message: NativeBrowserMessage) => void = () => undefined;
  const bridge: NativeBrowserBridge = {
    nativeBrowserCreate: vi.fn(async () => "tab-1"),
    nativeBrowserBounds: vi.fn(async () => undefined),
    nativeBrowserAction: vi.fn(async () => undefined),
    nativeBrowserDestroy: vi.fn(async () => undefined),
    nativeBrowserMarkUserNavigation: vi.fn(async () => undefined),
    onNativeBrowserEvent: vi.fn(async callback => { publish = callback; return vi.fn(); }),
  };
  return { element, bridge, publish: (message: NativeBrowserMessage) => publish(message) };
};

afterEach(() => document.body.replaceChildren());

describe("native child WebView Electron-compatible adapter", () => {
  it("uses a scoped native UI handle rather than a fake Electron guest ID", async () => {
    const { element, bridge } = make();
    expect(nativeBrowserBounds(element, false)).toEqual({x:0,y:0,width:0,height:0,visible:false});
    const adapter = createNativeBrowserAdapter(element, bridge, "about:blank");
    expect(adapter.view.getWebContentsId()).toBe(0);
    await adapter.mount();
    expect(adapter.view.getWebContentsId()).toBeGreaterThan(0);
    expect(bridge.nativeBrowserCreate).toHaveBeenCalledWith("about:blank", expect.objectContaining({ visible: false }));
    adapter.syncBounds(true);
    expect(bridge.nativeBrowserBounds).toHaveBeenCalledWith("tab-1", expect.objectContaining({ visible: true }));
    adapter.destroy();
    expect(bridge.nativeBrowserDestroy).toHaveBeenCalledWith("tab-1");
  });
  it("selects only the registered native WebView and closes only after Rust confirms", async () => {
    const a = make();
    const b = make();
    vi.mocked(b.bridge.nativeBrowserCreate).mockResolvedValue("tab-2");
    const first = createNativeBrowserAdapter(a.element, a.bridge, "about:blank");
    const second = createNativeBrowserAdapter(b.element, b.bridge, "about:blank");
    await first.mount();
    await second.mount();
    const firstId = first.view.getWebContentsId();
    const secondId = second.view.getWebContentsId();
    expect(firstId).toBeGreaterThan(0);
    expect(secondId).toBeGreaterThan(firstId);
    const close = vi.fn();
    const unsubscribe = onNativeTabClosed(close);
    first.syncBounds(true);
    second.syncBounds(true);
    selectNativeTab(firstId);
    expect(a.bridge.nativeBrowserBounds).toHaveBeenLastCalledWith("tab-1",
      expect.objectContaining({ visible: true }));
    expect(b.bridge.nativeBrowserBounds).toHaveBeenLastCalledWith("tab-2",
      expect.objectContaining({ visible: false }));
    selectNativeTab(secondId);
    expect(a.bridge.nativeBrowserBounds).toHaveBeenLastCalledWith("tab-1",
      expect.objectContaining({ visible: false }));
    expect(b.bridge.nativeBrowserBounds).toHaveBeenLastCalledWith("tab-2",
      expect.objectContaining({ visible: true }));
    selectNativeTab(999_999_999);
    expect(b.bridge.nativeBrowserBounds).toHaveBeenLastCalledWith("tab-2",
      expect.objectContaining({ visible: true }));
    second.destroy();
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith(secondId));
    expect(close).toHaveBeenCalledTimes(1);
    selectNativeTab(firstId);
    expect(a.bridge.nativeBrowserBounds).toHaveBeenLastCalledWith("tab-1",
      expect.objectContaining({ visible: true }));
    first.destroy();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2));
    unsubscribe();
  });
  it("only live native UI handles may report user navigation to their own Rust child", async () => {
    const { element, bridge } = make();
    const adapter = createNativeBrowserAdapter(element, bridge, "about:blank");
    await adapter.mount();
    const handle = adapter.view.getWebContentsId();
    await markNativeTabUserNavigation(handle);
    expect(bridge.nativeBrowserMarkUserNavigation).toHaveBeenCalledExactlyOnceWith("tab-1");
    await expect(markNativeTabUserNavigation(0)).rejects.toThrow();
    await expect(markNativeTabUserNavigation(999999)).rejects.toThrow();
    adapter.destroy();
    await vi.waitFor(async () => {
      await expect(markNativeTabUserNavigation(handle)).rejects.toThrow();
    });
  });
  it("does not flash a newly created WebView over the selected tab", async () => {
    const a = make();
    const b = make();
    vi.mocked(b.bridge.nativeBrowserCreate).mockResolvedValue("tab-2");
    const first = createNativeBrowserAdapter(a.element, a.bridge, "about:blank");
    first.syncBounds(true);
    await first.mount();
    selectNativeTab(first.view.getWebContentsId());
    const second = createNativeBrowserAdapter(b.element, b.bridge, "about:blank");
    second.syncBounds(true);
    await second.mount();
    expect(b.bridge.nativeBrowserCreate).toHaveBeenCalledWith("about:blank",
      expect.objectContaining({ visible: false }));
    expect(b.bridge.nativeBrowserBounds).toHaveBeenLastCalledWith("tab-2",
      expect.objectContaining({ visible: false }));
    selectNativeTab(second.view.getWebContentsId());
    expect(b.bridge.nativeBrowserBounds).toHaveBeenLastCalledWith("tab-2",
      expect.objectContaining({ visible: true }));
    first.destroy();
    second.destroy();
    await Promise.resolve();
  });
  it("never fires a successful close callback when native destroy fails", async () => {
    const { element, bridge } = make();
    vi.mocked(bridge.nativeBrowserDestroy).mockRejectedValue(Error("guest close failed"));
    const adapter = createNativeBrowserAdapter(element, bridge, "about:blank");
    await adapter.mount();
    const close = vi.fn();
    const unsubscribe = onNativeTabClosed(close);
    adapter.destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("maps real native navigation and titles to existing Electron-like DOM events", async () => {
    const { element, bridge, publish } = make();
    const adapter = createNativeBrowserAdapter(element, bridge, "about:blank");
    const events: string[] = [];
    for (const type of ["dom-ready","did-start-loading","did-stop-loading","did-navigate","page-title-updated"]) {
      element.addEventListener(type, () => events.push(type));
    }
    await adapter.mount();
    expect(events).toContain("dom-ready");
    publish({ id: "wrong-tab", kind: "finished", url: "https://not-us.example" });
    expect(adapter.view.getURL()).toBe("about:blank");
    await adapter.view.loadURL("https://example.org");
    expect(bridge.nativeBrowserAction).toHaveBeenCalledWith("tab-1","navigate","https://example.org");
    publish({ id: "tab-1", kind: "started", url: "https://example.org" });
    publish({ id: "tab-1", kind: "title", title: "Example" });
    publish({ id: "tab-1", kind: "finished", url: "https://example.org" });
    expect(adapter.view.getURL()).toBe("https://example.org");
    expect(adapter.view.getTitle()).toBe("Example");
    expect(adapter.view.canGoBack()).toBe(true);
    expect(events).toEqual(["dom-ready","did-start-loading","page-title-updated","did-navigate","did-stop-loading"]);
    adapter.view.goBack();
    await Promise.resolve();
    expect(bridge.nativeBrowserAction).toHaveBeenCalledWith("tab-1", "back", undefined);
    adapter.destroy();
  });
  it("refuses new browser creation after unmount while async create is pending", async () => {
    const { element, bridge } = make();
    let complete!: (id: string) => void;
    vi.mocked(bridge.nativeBrowserCreate).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const adapter = createNativeBrowserAdapter(element, bridge, "https://example.org");
    const mounting = adapter.mount();
    await Promise.resolve();
    adapter.destroy();
    complete("tab-2");
    await mounting;
    expect(bridge.nativeBrowserDestroy).toHaveBeenCalledWith("tab-2");
  });
  it("honors a URL queued before first mount without double-navigation", async () => {
    const { element, bridge } = make();
    const adapter = createNativeBrowserAdapter(element, bridge, "about:blank");
    await adapter.view.loadURL("https://example.net/queued");
    await adapter.mount();
    expect(bridge.nativeBrowserCreate).toHaveBeenCalledWith(
      "https://example.net/queued", expect.any(Object)
    );
    expect(bridge.nativeBrowserAction).not.toHaveBeenCalled();
    expect(adapter.view.getURL()).toBe("https://example.net/queued");
    adapter.destroy();
  });
  it("does not silently report native browser creation failure as success", async () => {
    const { element, bridge } = make();
    vi.mocked(bridge.nativeBrowserCreate).mockRejectedValue(new Error("native WebView unavailable"));
    const adapter = createNativeBrowserAdapter(element, bridge, "about:blank");
    await expect(adapter.mount()).rejects.toThrow("native WebView unavailable");
    adapter.destroy();
  });
});
