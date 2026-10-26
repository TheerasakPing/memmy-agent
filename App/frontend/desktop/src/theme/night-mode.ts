/** Local visual preference, separate from the Original app's database/account settings. */
export type NightMode = "light" | "dark" | "system";
export const NIGHT_MODE_STORAGE_KEY = "memmy-turbo-appearance-v1";
export const NIGHT_MODE_EVENT = "memmy-turbo-appearance-changed";

export function readNightMode(): NightMode {
  try {
    const value = localStorage.getItem(NIGHT_MODE_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "dark";
  } catch { return "dark"; }
}

export function resolveNightMode(preference: NightMode, systemDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function applyNightMode(preference = readNightMode()): void {
  document.documentElement.dataset.theme = resolveNightMode(preference);
  document.documentElement.style.colorScheme = resolveNightMode(preference);
}

export function writeNightMode(value: NightMode): void {
  try { localStorage.setItem(NIGHT_MODE_STORAGE_KEY, value); } catch { /* storage may be disabled */ }
  applyNightMode(value);
  window.dispatchEvent(new Event(NIGHT_MODE_EVENT));
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  applyNightMode();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (readNightMode() === "system") applyNightMode();
  });
}
