#!/usr/bin/env node
/**
 * R8 timezone diagnostics for the connected macOS host.
 * Only emits public clock/zone metadata; never reads user databases or keys.
 * Run on the actual Mac, then compare to Settings → Preferences and
 * Settings → About → Export diagnostics from the Tauri renderer.
 */
import { execFileSync } from "node:child_process";

function runDate() {
  try {
    return execFileSync("/bin/date", ["+%Y-%m-%dT%H:%M:%S%z"], {
      encoding: "utf8", timeout: 2500,
      env: { PATH: "/usr/bin:/bin", LANG: "C" }
    }).trim();
  } catch {
    return null;
  }
}
function minute(iso, zone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(iso));
  const part = type => parts.find(p => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
const cases = [
  { zone: "Asia/Bangkok", instant: "2026-10-27T15:30:00Z", expected: "2026-10-27 22:30" },
  { zone: "Asia/Bangkok", instant: "2026-10-27T18:05:00Z", expected: "2026-10-28 01:05" },
  { zone: "America/New_York", instant: "2026-01-15T12:00:00Z", expected: "2026-01-15 07:00" },
  { zone: "America/New_York", instant: "2026-07-15T12:00:00Z", expected: "2026-07-15 08:00" }
];
const tests = cases.map(c => ({ zone: c.zone, instant: c.instant, expected: c.expected,
  actual: minute(c.instant, c.zone), passed: minute(c.instant, c.zone) === c.expected }));
const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const now = new Date();
const result = {
  schema: "memmy-r8-timezone-diagnostics.v1",
  generatedAtUtc: now.toISOString(),
  hostTimezone: hostZone,
  systemUtcOffsetMinutes: -now.getTimezoneOffset(),
  localDateFromBinDate: runDate(),
  hostLocalTime: minute(now.toISOString(), hostZone),
  bangkokLocalTime: minute(now.toISOString(), "Asia/Bangkok"),
  timezoneConversionTests: tests,
  passed: tests.every(t => t.passed),
  note: "Renderer and Agent configured time zones must be checked separately. No app or database was changed."
};
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
