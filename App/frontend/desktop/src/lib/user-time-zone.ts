/**
 * Renderer time-zone authority.
 *
 * Persist absolute instants in UTC. Only presentation and user-facing
 * scheduling use a time zone. Preserve IANA names to avoid DST errors.
 */
export const USER_TIME_ZONE_STORAGE_KEY = "memmy.display.timeZone.v1";
const SYSTEM_TIME_ZONE = "system";

let configuredTimeZone: string | undefined;

/** Override for configuration/tests; undefined uses the saved UI preference. */
export function configureUserTimeZone(value?: string): void {
  configuredTimeZone = value?.trim() ? normalizeUserTimeZone(value) : undefined;
}

/** Read the saved renderer preference without throwing in private/blocked WebViews. */
export function preferredUserTimeZone(): string {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(USER_TIME_ZONE_STORAGE_KEY);
    return stored && stored !== SYSTEM_TIME_ZONE ? normalizeUserTimeZone(stored) : SYSTEM_TIME_ZONE;
  } catch {
    return SYSTEM_TIME_ZONE;
  }
}

/**
 * Initialize the zone before the first routed frame is painted.
 *
 * A Thai-language local macOS installation defaults to Asia/Bangkok only on
 * first run. Existing explicit user choices, including "system", always win.
 * This is a display preference, NOT a rewrite of Agent cron configuration.
 */
export function initializeUserTimeZone(language: string | undefined, isTauri: boolean): string {
  if (typeof window === "undefined") return userTimeZone();
  try {
    const stored = window.localStorage.getItem(USER_TIME_ZONE_STORAGE_KEY);
    if (stored) {
      try {
        const normalized = stored === SYSTEM_TIME_ZONE ? SYSTEM_TIME_ZONE : normalizeUserTimeZone(stored);
        if (normalized !== stored) window.localStorage.setItem(USER_TIME_ZONE_STORAGE_KEY, normalized);
        return normalized === SYSTEM_TIME_ZONE ? detectedUserTimeZone() : normalized;
      } catch {
        // A malformed/obsolete setting must not block renderer startup.
        window.localStorage.removeItem(USER_TIME_ZONE_STORAGE_KEY);
      }
    }
    if (isTauri && language === "th-TH") {
      window.localStorage.setItem(USER_TIME_ZONE_STORAGE_KEY, "Asia/Bangkok");
      return "Asia/Bangkok";
    }
  } catch {
    // Storage access may fail in private/embedded WebViews. Use host zone.
  }
  return detectedUserTimeZone();
}

/** Persist an explicit UI choice (including "system") across restarts. */
export function savePreferredUserTimeZone(value: string): void {
  const normalized = value === SYSTEM_TIME_ZONE ? SYSTEM_TIME_ZONE : normalizeUserTimeZone(value);
  if (typeof window === "undefined") throw new Error("Time-zone settings require a renderer");
  window.localStorage.setItem(USER_TIME_ZONE_STORAGE_KEY, normalized);
  configuredTimeZone = undefined;
}

/** Uses the system's IANA zone, falling back to an offset only if unavailable. */
export function detectedUserTimeZone(): string {
  try {
    const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (name) return normalizeUserTimeZone(name);
  } catch {
    // Some embedded runtimes do not expose their system IANA identifier.
  }
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

/** Config > explicit user preference > host IANA zone. */
export function userTimeZone(value = configuredTimeZone): string {
  if (value?.trim()) return normalizeUserTimeZone(value);
  const preference = preferredUserTimeZone();
  return preference === SYSTEM_TIME_ZONE ? detectedUserTimeZone() : preference;
}

/**
 * Normalizes fixed UTC offsets, but preserves named zones (e.g. Asia/Bangkok)
 * instead of collapsing them into a current offset, which loses DST rules.
 */
export function normalizeUserTimeZone(value: string): string {
  const name = value.trim();
  if (/^(?:UTC|GMT|Z)$/i.test(name)) return "+00:00";
  const fixed = /^(?:(?:UTC|GMT)\s*)?([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(name);
  if (fixed) {
    const hours = Number(fixed[2]);
    const minutes = Number(fixed[3] ?? 0);
    if (hours <= 14 && minutes <= 59 && (hours < 14 || minutes === 0)) {
      return `${fixed[1]}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
    throw new Error(`invalid timezone: ${value}`);
  }
  // Intl validates and canonicalizes IANA names (not a GMT offset snapshot).
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: name });
    return formatter.resolvedOptions().timeZone;
  } catch {
    throw new Error(`invalid timezone: ${value}`);
  }
}

function asValidDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Locale-aware full date/time in the explicit UI zone. */
export function formatUserDateTime(value: string | number | Date, language?: string): string {
  const date = asValidDate(value);
  return date ? date.toLocaleString(language, { timeZone: userTimeZone() }) : String(value);
}

/** Locale-aware time in the explicit UI zone. */
export function formatUserTime(value: string | number | Date, language?: string): string {
  const date = asValidDate(value);
  return date ? date.toLocaleTimeString(language, { timeZone: userTimeZone() }) : String(value);
}

/** Stable Gregorian, 24-hour local timestamp (YYYY-MM-DD HH:mm). */
export function formatUserMinute(value: string | number | Date): string {
  const date = asValidDate(value);
  if (!date) return String(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: userTimeZone(),
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
