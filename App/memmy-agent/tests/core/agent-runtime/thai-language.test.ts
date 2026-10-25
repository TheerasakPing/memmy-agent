import { describe, expect, it } from "vitest";
import { normalizeAgentResponseLanguage, responseLanguageSection } from "../../../src/core/agent-runtime/context.js";
import { normalizeWebuiLanguage } from "../../../src/integrations/channels/websocket.js";

describe("Thai native desktop Agent language", () => {
  it("accepts th-TH at the authenticated WebUI protocol boundary", () => {
    expect(normalizeWebuiLanguage("th-TH")).toBe("th-TH");
    expect(normalizeWebuiLanguage("th_TH")).toBeNull();
    expect(normalizeAgentResponseLanguage("th-TH")).toBe("th-TH");
    expect(normalizeAgentResponseLanguage("th_TH")).toBeNull();
  });
  it("instructs user-visible Agent responses and tool steps to use Thai", () => {
    const section = responseLanguageSection("th-TH");
    expect(section?.id).toBe("response-language");
    expect(section?.content).toContain("ภาษาไทย");
    expect(section?.content).toContain("คำอธิบายขั้นตอนเครื่องมือ");
    expect(responseLanguageSection(null)).toBeNull();
  });
});
