import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHttpServer } from "../../src/index.js";
import { Repositories } from "../../src/storage/repositories.js";
import { createMemoryServiceFixture } from "../fixtures/memory-service-fixture.js";

const { cleanup, createTestService } = createMemoryServiceFixture();
afterEach(cleanup);

const owner = {
  source: "codex", profileId: "default", tenantId: "tenant-search-A",
  userId: "shared-tenant-search-user", projectId: "shared-tenant-search-project"
};
const other = { ...owner, tenantId: "tenant-search-B" };

describe("R2 SQL pre-retrieval tenant boundary", () => {
  it("filters vector/FTS source rows by durable tenant before scoring, preserving local reads", async () => {
    const { db, service } = createTestService();
    try {
      const first = service.addMemory({
        namespace: owner, requestId: "sql-tenant-a", adapterId: "r2-tenant-search",
        layer: "L2", content: "Secret narwhal lighthouse belongs only to tenant A",
        deferProcessing: true
      });
      const second = service.addMemory({
        namespace: other, requestId: "sql-tenant-b", adapterId: "r2-tenant-search",
        layer: "L2", content: "Secret narwhal lighthouse belongs only to tenant B",
        deferProcessing: true
      });
      const legacy = service.addMemory({
        namespace: { source: "codex", profileId: "default", userId: owner.userId, projectId: owner.projectId },
        requestId: "sql-tenant-legacy", adapterId: "r2-tenant-search",
        layer: "L2", content: "Secret narwhal lighthouse is unowned local memory",
        deferProcessing: true
      });
      const repos = new Repositories(db.db);
      const scope = (tenantId: string) => ({
        tenantId, tenantUserId: owner.userId, tenantProjectId: owner.projectId,
        memoryLayer: "L2" as const
      });
      expect(repos.memories.list(scope(owner.tenantId), 100).map((m) => m.id)).toContain(first.id);
      expect(repos.memories.list(scope(owner.tenantId), 100).map((m) => m.id)).not.toContain(second.id);
      expect(repos.memories.list(scope(owner.tenantId), 100).map((m) => m.id)).not.toContain(legacy.id);
      expect(repos.memories.list(scope(other.tenantId), 100).map((m) => m.id)).toContain(second.id);
      expect(repos.memories.list({ tenantId: owner.tenantId }, 100)).toHaveLength(0);
      expect(repos.memories.list({ memoryLayer: "L2" }, 100).map((m) => m.id))
        .toEqual(expect.arrayContaining([first.id, second.id, legacy.id]));

      const fromOwner = await service.search({
        namespace: owner, query: "narwhal lighthouse", layers: ["L2"],
        recordEvent: false, verbose: true
      });
      expect(fromOwner.candidateMemoryIds).toContain(first.id);
      expect(fromOwner.candidateMemoryIds).not.toContain(second.id);
      const fromOther = await service.search({
        namespace: other, query: "narwhal lighthouse", layers: ["L2"],
        recordEvent: false, verbose: true
      });
      expect(fromOther.candidateMemoryIds).toContain(second.id);
      expect(fromOther.candidateMemoryIds).not.toContain(first.id);
      expect(fromOther.sourceMemoryIds).not.toContain(first.id);
      expect(fromOther.hits.map((hit) => hit.id)).not.toContain(first.id);
      expect(db.db.prepare("SELECT COUNT(*) AS count FROM recall_events").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("blocks unowned global panel/export/log endpoints for authenticated scoped tenants", async () => {
    const { db, service } = createTestService();
    const privateA = service.addMemory({
      namespace: owner, requestId: "http-tenant-a", adapterId: "r2-http-search",
      layer: "L2", content: "Indigo seahorse mission from tenant A", deferProcessing: true
    });
    const privateB = service.addMemory({
      namespace: other, requestId: "http-tenant-b", adapterId: "r2-http-search",
      layer: "L2", content: "Indigo seahorse mission from tenant B", deferProcessing: true
    });
    const server = createMemoryHttpServer({
      service,
      auth: {
        scopedApiKeys: {
          "search-owner": { namespace: owner, scopes: ["memory:read", "memory:write", "panel:read"] },
          "search-other": { namespace: other, scopes: ["memory:read", "memory:write", "panel:read"] }
        }
      }
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("missing test port");
      const base = `http://127.0.0.1:${addr.port}/api/v1`;
      for (const path of ["/admin/export", "/panel/items", "/panel/overview", "/panel/analysis", "/memory/logs", "/memory/recalls/unowned"]) {
        const res = await fetch(base + path, { headers: { authorization: "Bearer search-other" } });
        expect(res.status, path).toBe(403);
      }
      const queryCredential = await fetch(base + "/panel/tasks?token=search-owner");
      expect(queryCredential.status).toBe(401);
      const mixedCredential = await fetch(base + "/panel/tasks?access_token=search-other", {
        headers: { authorization: "Bearer search-owner" }
      });
      expect(mixedCredential.status).toBe(401);
      const response = await fetch(base + "/memory/search", {
        method: "POST",
        headers: { authorization: "Bearer search-owner", "content-type": "application/json" },
        body: JSON.stringify({ query: "nothing private", recordEvent: false, verbose: true })
      });
      expect(response.status).toBe(200);
      const remoteSearch = async (key: string) => {
        const result = await fetch(base + "/memory/search", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ query: "indigo seahorse mission", recordEvent: false, verbose: true })
        });
        expect(result.status).toBe(200);
        return result.json() as Promise<{
          debug: { hits: Array<{ id: string }>; sourceMemoryIds: string[] }
        }>;
      };
      const resultA = await remoteSearch("search-owner");
      const resultB = await remoteSearch("search-other");
      expect(resultA.debug.hits.map((hit) => hit.id)).toContain(privateA.id);
      expect(resultA.debug.hits.map((hit) => hit.id)).not.toContain(privateB.id);
      expect(resultB.debug.hits.map((hit) => hit.id)).toContain(privateB.id);
      expect(resultB.debug.hits.map((hit) => hit.id)).not.toContain(privateA.id);
      expect(resultB.debug.sourceMemoryIds).not.toContain(privateA.id);
      expect(db.db.prepare("SELECT COUNT(*) AS count FROM recall_events").get()).toEqual({ count: 0 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  });

  it("denies a foreign tenant session before reading its recent raw turns", async () => {
    const { db, service } = createTestService();
    try {
      const session = service.openSession({
        namespace: owner, requestId: "r2-search-owned-session",
        adapterId: "r2-search-session"
      });
      await expect(service.search({
        namespace: other, sessionId: session.sessionId,
        query: "find private turns", recordEvent: false
      })).rejects.toThrow(/tenant/);
    } finally {
      db.close();
    }
  });
});
