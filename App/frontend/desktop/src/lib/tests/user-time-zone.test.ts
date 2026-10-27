import { afterEach, describe, expect, it } from "vitest";
import {
  configureUserTimeZone,
  detectedUserTimeZone,
  formatUserDateTime,
  formatUserMinute,
  formatUserTime,
  normalizeUserTimeZone,
  userTimeZone
} from "../user-time-zone.js";

afterEach(() => configureUserTimeZone());

describe("userTimeZone", () => {
  it("prefers config and detects the system timezone only when config is absent", () => {
    configureUserTimeZone("UTC");
    expect(userTimeZone()).toBe("+00:00");
    configureUserTimeZone();
    expect(userTimeZone()).toBe(detectedUserTimeZone());
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
