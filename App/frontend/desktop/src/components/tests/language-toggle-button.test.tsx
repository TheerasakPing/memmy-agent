import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageToggleButton, nextDisplayLanguage } from "../language-toggle-button.js";

describe("three-language entry screen selector", () => {
  it("cycles Chinese, English, and Thai without skipping any locale", () => {
    expect(nextDisplayLanguage("zh-CN")).toBe("en-US");
    expect(nextDisplayLanguage("en-US")).toBe("th-TH");
    expect(nextDisplayLanguage("th-TH")).toBe("zh-CN");
    expect(nextDisplayLanguage(nextDisplayLanguage(nextDisplayLanguage("th-TH")))).toBe("th-TH");
  });

  it.each([false, true])("renders accessible Thai and other next-language buttons (embedded=%s)", embedded => {
    const render = (language: "zh-CN" | "en-US" | "th-TH") =>
      renderToStaticMarkup(createElement(LanguageToggleButton, { language, embedded, onClick: () => {} }));
    expect(render("zh-CN")).toContain("Switch to English");
    expect(render("en-US")).toContain("เปลี่ยนเป็นภาษาไทย");
    expect(render("en-US")).toContain("ไทย");
    expect(render("th-TH")).toContain("Switch to Chinese");
  });
});
