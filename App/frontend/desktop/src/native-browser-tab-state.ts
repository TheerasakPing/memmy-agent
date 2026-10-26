/** Native UI tab IDs are process-local handles, NEVER Electron webContents IDs
 * and NEVER identities for the independent Agent Playwright/browser executor.
 */
type NativeTab = {
  onSelection: () => void;
  markNavigation?: () => Promise<void>;
  copyActualUrl?: () => Promise<void>;
};
const tabs = new Map<number, NativeTab>();
const listeners = new Set<(handle: number) => void>();
let nextId = 1;
let selected: number | null | undefined = undefined;

export function registerNativeTab(
  onSelection: () => void, markNavigation?: () => Promise<void>,
  copyActualUrl?: () => Promise<void>
): number {
  if (tabs.size >= 10 || !Number.isSafeInteger(nextId)) throw Error("native tab budget exhausted");
  const id = nextId++;
  tabs.set(id, { onSelection, markNavigation, copyActualUrl });
  return id;
}
export async function markNativeTabUserNavigation(handle: number): Promise<void> {
  if (!Number.isSafeInteger(handle) || handle <= 0) throw Error("native browser tab invalid");
  const tab = tabs.get(handle);
  if (!tab?.markNavigation) throw Error("native browser tab no longer available");
  await tab.markNavigation();
}
/**
 * Fallback for Tauri child WebKit only: copy a real URL the Agent can open in
 * its independent browser, NOT a plugin://browser@memmy CDP target mention.
 */
export async function copyNativeTabPageUrl(handle: number): Promise<void> {
  if (!Number.isSafeInteger(handle) || handle <= 0) throw Error("native browser tab invalid");
  const tab = tabs.get(handle);
  if (!tab?.copyActualUrl) throw Error("native browser tab no longer available");
  await tab.copyActualUrl();
}
export function isNativeTabVisible(id: number): boolean {
  return selected === undefined || selected === id;
}
export function selectNativeTab(id: number | null): void {
  if (id !== null && (!Number.isSafeInteger(id) || id <= 0 || !tabs.has(id))) return;
  if (selected === id) return;
  selected = id;
  for (const tab of tabs.values()) tab.onSelection();
}
export function releaseNativeTab(id: number, confirmedClosed = true): void {
  if (!tabs.delete(id)) return;
  if (selected === id) selected = null;
  for (const tab of tabs.values()) tab.onSelection();
  if (confirmedClosed) for (const callback of [...listeners]) callback(id);
  if (tabs.size === 0) selected = undefined;
}
export function onNativeTabClosed(callback: (handle: number) => void): () => void {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}
