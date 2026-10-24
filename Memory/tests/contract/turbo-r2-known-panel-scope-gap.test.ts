import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHttpServer } from "../../src/index.js";
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

  it("filters HTTP panel/tasks results for authenticated same-user cross-tenant tokens", async () => {
    const { db, service } = createTestService();
    const owner = {
      source: "codex", profileId: "default", userId: "panel-http-user",
      projectId: "panel-http-project", tenantId: "tenant-A"
    };
    const intruder = { ...owner, tenantId: "tenant-B" };
    const session = service.openSession({
      namespace: owner, requestId: "r2-http-panel-session", adapterId: "r2-panel-http"
    });
    service.completeTurn("r2-panel-http-turn", {
      sessionId: session.sessionId, requestId: "r2-panel-http-complete",
      adapterId: "r2-panel-http", query: "Tenant A private context",
      answer: "Tenant A answer", status: "succeeded"
    });
    const server = createMemoryHttpServer({
      service,
      auth: { scopedApiKeys: {
        "panel-owner": { namespace: owner, scopes: ["panel:read"] },
        "panel-intruder": { namespace: intruder, scopes: ["panel:read"] }
      } }
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no local test port");
      const getTasks = async (key: string) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/panel/tasks`, {
          headers: { authorization: `Bearer ${key}` }
        });
        expect(response.status).toBe(200);
        return response.json() as Promise<{ total: number; tasks: Array<{ id: string; turns: unknown[] }> }>;
      };
      const fromOwner = await getTasks("panel-owner");
      const fromOther = await getTasks("panel-intruder");
      expect(fromOwner.total).toBe(1);
      expect(fromOwner.tasks).toHaveLength(1);
      expect(fromOther.total).toBe(0);
      expect(fromOther.tasks).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  });
});
