import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectMcpServers } from "../../../src/core/agent-runtime/tools/mcp.js";
import { ToolRegistry } from "../../../src/core/agent-runtime/tools/registry.js";
import { SkillsLoader } from "../../../src/core/agent-runtime/skills.js";

describe("R8 isolated real MCP transport / Skills integration", () => {
  it("loads a local SKILL.md and resolves the actual content", () => {
    const root = mkdtempSync(join(tmpdir(), "memmy-r8-skill-"));
    try {
      const dir = join(root, "skills", "r8-smoke");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), "---\nname: r8-smoke\ndescription: Isolated QA skill\n---\n\n# R8 smoke\nInspect the safe tool result.\n");
      const loader = new SkillsLoader(root);
      expect(loader.listSkills(false).some(x => x.name === "r8-smoke")).toBe(true);
      expect(loader.loadSkill("r8-smoke")).toContain("Inspect the safe tool result.");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("starts a real MCP stdio child and invokes its registered tool", { timeout: 30000 }, async () => {
    const fixture = fileURLToPath(new URL("./fixtures/r8-stdio-mcp-server.mjs", import.meta.url));
    const registry = new ToolRegistry();
    const stacks = await connectMcpServers({
      r8_live: { command: process.execPath, args: [fixture], enabled_tools: ["r8_echo"] }
    }, registry);
    try {
      expect(Object.keys(stacks)).toContain("r8_live");
      expect(registry.has("mcp_r8_live_r8_echo")).toBe(true);
      const result = await registry.execute("mcp_r8_live_r8_echo", { text: "transport-ok" });
      expect(JSON.stringify(result)).toContain("R8 MCP transport-ok");
    } finally {
      await Promise.allSettled(Object.values(stacks).map(stack => stack.close?.() ?? Promise.resolve()));
    }
  });
});
