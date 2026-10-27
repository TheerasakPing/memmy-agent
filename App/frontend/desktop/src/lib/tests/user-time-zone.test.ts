import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureUserTimeZone,
  detectedUserTimeZone,
  formatUserDateTime,
  formatUserMinute,
  formatUserTime,
  initializeUserTimeZone,
  normalizeUserTimeZone,
  preferredUserTimeZone,
  savePreferredUserTimeZone,
  userTimeZone
} from "../user-time-zone.js";

afterEach(() => {
  configureUserTimeZone();
  vi.unstubAllGlobals();
});

describe("userTimeZone", () => {
  it("prefers config and detects the system timezone only when config is absent", () => {
    configureUserTimeZone("UTC");
    expect(userTimeZone()).toBe("+00:00");
    configureUserTimeZone();
    expect(userTimeZone()).toBe(detectedUserTimeZone());
  });

  it("persists a user-selected zone and restores system mode", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); }
      }
    });
    savePreferredUserTimeZone("Asia/Bangkok");
    expect(preferredUserTimeZone()).toBe("Asia/Bangkok");
    expect(userTimeZone()).toBe("Asia/Bangkok");
    savePreferredUserTimeZone("+00:00");
    expect(preferredUserTimeZone()).toBe("+00:00");
    savePreferredUserTimeZone("system");
    expect(preferredUserTimeZone()).toBe("system");
    expect(userTimeZone()).toBe(detectedUserTimeZone());
  });

  it("automatically initializes Bangkok on a Thai local macOS launch only once", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); }
      }
    });
    expect(initializeUserTimeZone("th-TH", true)).toBe("Asia/Bangkok");
    expect(preferredUserTimeZone()).toBe("Asia/Bangkok");
    expect(formatUserMinute("2026-10-27T15:30:00.000Z")).toBe("2026-10-27 22:30");
    expect(initializeUserTimeZone("en-US", true)).toBe("Asia/Bangkok");
    savePreferredUserTimeZone("system");
    expect(initializeUserTimeZone("th-TH", true)).toBe(detectedUserTimeZone());
    expect(preferredUserTimeZone()).toBe("system");
    savePreferredUserTimeZone("America/New_York");
    expect(initializeUserTimeZone("th-TH", true)).toBe("America/New_York");
    expect(preferredUserTimeZone()).toBe("America/New_York");
  });

  it("does not force Bangkok on a non-Thai or non-Tauri launch", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); }
      }
    });
    expect(initializeUserTimeZone("en-US", true)).toBe(detectedUserTimeZone());
    expect(preferredUserTimeZone()).toBe("system");
    expect(initializeUserTimeZone("th-TH", false)).toBe(detectedUserTimeZone());
    expect(preferredUserTimeZone()).toBe("system");
  });

  it("recovers from an invalid previous preference during auto-start", () => {
    const values = new Map<string, string>([["memmy.display.timeZone.v1", "Mars/Base"]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); }
      }
    });
    expect(initializeUserTimeZone("th-TH", true)).toBe("Asia/Bangkok");
    expect(preferredUserTimeZone()).toBe("Asia/Bangkok");
  });

  it("preserves IANA names, including the Bangkok time zone", () => {
    configureUserTimeZone("Asia/Bangkok");
    expect(userTimeZone()).toBe("Asia/Bangkok");
    expect(formatUserMinute("2026-10-27T15:30:00.000Z")).toBe("2026-10-27 22:30");
    expect(formatUserMinute("2026-10-27T18:05:00.000Z")).toBe("2026-10-28 01:05");
  });

  it("uses daylight-saving rules for both historical and future dates", () => {
    configureUserTimeZone("America/New_York");
    expect(formatUserMinute("2026-01-15T12:00:00.000Z")).toBe("2026-01-15 07:00");
    expect(formatUserMinute("2026-07-15T12:00:00.000Z")).toBe("2026-07-15 08:00");
    expect(userTimeZone()).toBe("America/New_York");
  });

  it("preserves fixed offsets and validates invalid input", () => {
    expect(normalizeUserTimeZone("UTC+7")).toBe("+07:00");
    expect(normalizeUserTimeZone("+0700")).toBe("+07:00");
    expect(normalizeUserTimeZone("GMT")).toBe("+00:00");
    expect(() => normalizeUserTimeZone("Asia/NotARealPlace")).toThrow(/invalid timezone/);
    expect(() => normalizeUserTimeZone("+15:00")).toThrow(/invalid timezone/);
  });

  it("applies the same time zone to chat and general formatting", () => {
    configureUserTimeZone("Asia/Bangkok");
    const date = "2026-10-27T15:30:00.000Z";
    expect(formatUserDateTime(date, "en-GB")).toContain("22:30");
    expect(formatUserTime(date, "en-GB")).toContain("22:30");
    expect(formatUserMinute("not-a-date")).toBe("not-a-date");
  });
});
