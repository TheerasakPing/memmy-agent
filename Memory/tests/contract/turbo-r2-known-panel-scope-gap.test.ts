import { afterEach, describe, expect, it } from "vitest";
import { createMemoryServiceFixture } from "../fixtures/memory-service-fixture.js";

/**
 * Known-failure security canary: unlike regular tests, Vitest's it.fails
 * documents a still-open disclosure issue. A green XFAIL does NOT mean safe.
 * Convert to an ordinary test only after the repository query is tenant-scoped.
 */
const { cleanup, createTestService } = createMemoryServiceFixture();
afterEach(cleanup);

describe("R2 known-failure tenant Panel read isolation", () => {
  it.fails("must not include tenant-A episode/turn when tenant-B uses same user and project", () => {
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
      const panel = service.panelTasks({ namespace: intruder });
      expect(panel.tasks.map((task) => task.id)).not.toContain(turn.episodeId);
      expect(panel.tasks.flatMap((task) => task.turns).length).toBe(0);
    } finally {
      db.close();
    }
  });
});
