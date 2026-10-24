import { afterEach, describe, expect, it } from "vitest";
import { createMemoryServiceFixture } from "../fixtures/memory-service-fixture.js";

/** Scoped Panel authorization regression; real passing security assertion. */
const { cleanup, createTestService } = createMemoryServiceFixture();
afterEach(cleanup);

describe("R2 persisted tenant Panel read isolation", () => {
  it("excludes tenant-A episode/turn from tenant-B even with same user and project", () => {
    const { db, service } = createTestService();
    const owner = {
      source: "codex", profileId: "default", userId: "panel-shared-user",
      projectId: "panel-shared-project", tenantId: "tenant-A"
    };
    const intruder = { ...owner, tenantId: "tenant-B" };
    try {
      const session = service.openSession({
        namespace: owner,
        requestId: "r2-panel-open",
        adapterId: "r2-panel-security"
      });
      const turn = service.completeTurn("r2-panel-turn", {
        sessionId: session.sessionId,
        requestId: "r2-panel-complete",
        adapterId: "r2-panel-security",
        query: "Tenant A only: secret plan",
        answer: "Do not disclose to tenant B",
        status: "succeeded"
      });
      const ownerPanel = service.panelTasks({ namespace: owner });
      expect(ownerPanel.tasks.map((task) => task.id)).toContain(turn.episodeId);
      expect(ownerPanel.total).toBe(1);
      const panel = service.panelTasks({ namespace: intruder });
      expect(panel.total).toBe(0);
      expect(panel.tasks.map((task) => task.id)).not.toContain(turn.episodeId);
      expect(panel.tasks.flatMap((task) => task.turns).length).toBe(0);
      // Pre-existing single-user local panel is still cross-agent shared.
      const localPanel = service.panelTasks({
        namespace: { source: "claude_code", profileId: "default", userId: "panel-shared-user" }
      });
      expect(localPanel.tasks.map((task) => task.id)).toContain(turn.episodeId);
    } finally {
      db.close();
    }
  });
});
