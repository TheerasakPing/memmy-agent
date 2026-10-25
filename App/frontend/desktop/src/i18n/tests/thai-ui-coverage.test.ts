import { describe, expect, it } from "vitest";
import { messageCatalogs, resolveLanguage } from "../messages.js";
import { thMessages } from "../th-messages.js";

describe("Thai UI locale", () => {
  it("resolves th-TH and uses Thai translations for critical navigation", () => {
    expect(resolveLanguage("th-TH")).toBe("th-TH");
    for (const key of ["app.loading.status", "app.error.status", "settings.title", "settings.language", "memory.nav.overview", "memory.nav.skills", "browser.title", "pet.status.processing"]) {
      expect(thMessages[key]).toMatch(/[\u0e00-\u0e7f]/u);
      expect(messageCatalogs["th-TH"][key as keyof typeof messageCatalogs["th-TH"]]).toBe(thMessages[key]);
    }
  });
  it("preserves replacement placeholders when falling back to English", () => {
    const english = messageCatalogs["en-US"];
    const thai = messageCatalogs["th-TH"];
    for (const [key, value] of Object.entries(thMessages)) {
      expect(key in english, `${key} has no English message`).toBe(true);
      const placeholders = (value.match(/\{\w+\}/g) ?? []).sort();
      const original = (english[key as keyof typeof english].match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders, `${key} interpolations changed`).toEqual(original);
      expect(thai[key as keyof typeof thai]).toBe(value);
    }
  });
});
