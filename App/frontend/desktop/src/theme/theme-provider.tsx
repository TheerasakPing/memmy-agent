/** Theme provider module. */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Theme } from "@memmy/local-api-contracts";
import { applyNightMode, readNightMode, resolveNightMode } from "./night-mode.js";

/** Type definition for resolved theme. */
export type ResolvedTheme = "light" | "dark";

/** Contract for theme context value. */
export interface ThemeContextValue {
  theme: Theme | string | undefined;
  resolvedTheme: ResolvedTheme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Handles resolve theme preference. */
export function resolveThemePreference(theme: Theme | string | undefined, systemPrefersDark?: boolean): ResolvedTheme {
  const local = readNightMode();
  if (local !== "system") return resolveNightMode(local);
  return resolveNightMode(theme === "dark" || theme === "light" ? theme : "system", systemPrefersDark);
}

/** Handles theme provider. */
export function ThemeProvider(props: { theme: Theme | string | undefined; children: ReactNode }) {
  const resolvedTheme = resolveThemePreference(props.theme);
  const value = useMemo(() => ({ theme: props.theme, resolvedTheme }), [props.theme, resolvedTheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    // Local toggle remains authoritative even after provider re-renders.
    if (readNightMode() !== "system") applyNightMode();
  }, [resolvedTheme]);

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

/** Handles use theme context. */
export function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }

  return value;
}
