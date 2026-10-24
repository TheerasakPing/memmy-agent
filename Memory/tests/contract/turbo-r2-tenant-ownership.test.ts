import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHttpServer } from "../../src/index.js";
import { createMemoryServiceFixture } from "../fixtures/memory-service-fixture.js";

const { cleanup, createTestService } = createMemoryServiceFixture();
afterEach(cleanup);
const auth = {
  scopedApiKeys: {
    "owner-key": {
      namespace: {
        source: "codex", profileId: "default", userId: "same-person",
        projectId: "shared-project", tenantId: "tenant-A"
      },
      scopes: ["memory:read", "memory:write"]
    },
    "intruder-key": {
      namespace: {
        source: "codex", profileId: "default", userId: "same-person",
        projectId: "shared-project", tenantId: "tenant-B"
      },
      scopes: ["memory:read", "memory:write"]
    }
  }
};

describe("R2 scoped tenant ownership — local shared-memory unchanged", () => {
  it("permits owner GET/DELETE but denies another tenant with identical user/project", async () => {
    const { db, service } = createTestService();
    const server = createMemoryHttpServer({ service, auth });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing local port");
      const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
      const send = (method: "GET" | "POST" | "DELETE", path: string, key: string, body?: Record<string, unknown>, headers: Record<string,string> = {}) =>
        fetch(baseUrl + path, {
          method,
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
            ...headers
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });

      const add = await send("POST", "/memory/add", "owner-key", {
        requestId: "r2-tenant-add-1",
        adapterId: "r2-isolation-test",
        layer: "L2",
        content: "Tenant A owns this fact",
        deferProcessing: true
      });
      expect(add.status).toBe(200);
      const created = await add.json() as { id: string };
      expect(created.id).toBeTruthy();
      const row = db.db.prepare("SELECT properties_json FROM memories WHERE id = ?").get(created.id) as { properties_json: string };
      const props = JSON.parse(row.properties_json) as { internal_info: { tenant_id?: string } };
      expect(props.internal_info.tenant_id).toBe("tenant-A");

      // Identical request ID/adapter from a second tenant must never upsert
      // into the first tenant's Memory, even for the same user/project.
      const otherAdd = await send("POST", "/memory/add", "intruder-key", {
        requestId: "r2-tenant-add-1",
        adapterId: "r2-isolation-test",
        layer: "L2",
        content: "Tenant B owns a different fact",
        deferProcessing: true
      });
      expect(otherAdd.status).toBe(200);
      const otherCreated = await otherAdd.json() as { id: string };
      expect(otherCreated.id).not.toBe(created.id);
      const otherRow = db.db.prepare("SELECT properties_json FROM memories WHERE id = ?").get(otherCreated.id) as { properties_json: string };
      expect((JSON.parse(otherRow.properties_json) as { internal_info: {tenant_id:string} }).internal_info.tenant_id).toBe("tenant-B");
      const ownerRowAfterOther = db.db.prepare("SELECT memory_value FROM memories WHERE id = ?").get(created.id) as { memory_value: string };
      expect(ownerRowAfterOther.memory_value).toContain("Tenant A owns this fact");

      const ownerRead = await send("GET", `/memory/${created.id}`, "owner-key");
      expect(ownerRead.status).toBe(200);
      const otherRead = await send("GET", `/memory/${created.id}`, "intruder-key");
      expect(otherRead.status).toBe(403);

      const otherDelete = await send("DELETE", `/memory/${created.id}`, "intruder-key", {});
      expect(otherDelete.status).toBe(403);
      expect((db.db.prepare("SELECT status FROM memories WHERE id = ?").get(created.id) as { status: string }).status).not.toBe("deleted");

      const spoofedHeader = await send("GET", `/memory/${created.id}`, "intruder-key", undefined, {
        "x-memmy-tenant-id": "tenant-A"
      });
      expect(spoofedHeader.status).toBe(403);

      const spoofedBody = await send("POST", "/memory/add", "intruder-key", {
        requestId: "r2-tenant-spoof",
        adapterId: "r2-isolation-test",
        content: "Do not save under tenant-A",
        namespace: { source: "codex", profileId: "default", tenantId: "tenant-A" }
      });
      expect(spoofedBody.status).toBe(403);

      // Legacy records without durable tenant ownership cannot be claimed
      // simply by presenting a scoped token with the same user/project.
      const legacy = service.addMemory({
        requestId: "legacy-tenant-unowned",
        adapterId: "r2-legacy-unowned",
        layer: "L2",
        content: "Pre-tenant local record",
        deferProcessing: true,
        namespace: { source: "codex", profileId: "default", userId: "same-person", projectId: "shared-project" }
      });
      const legacyReadAsScoped = await send("GET", `/memory/${legacy.id}`, "owner-key");
      expect(legacyReadAsScoped.status).toBe(403);

      // Session creation uses the same adapter/request IDs but separate tenant
      // identity; no tenant may resume another tenant's idempotent session.
      const opening = {
        requestId: "r2-open-collision",
        adapterId: "r2-shared-adapter"
      };
      const ownerOpen = await send("POST", "/sessions/open", "owner-key", opening);
      const intruderOpen = await send("POST", "/sessions/open", "intruder-key", opening);
      expect(ownerOpen.status).toBe(200);
      expect(intruderOpen.status).toBe(200);
      const openedA = await ownerOpen.json() as { sessionId: string };
      const openedB = await intruderOpen.json() as { sessionId: string };
      expect(openedA.sessionId).not.toBe(openedB.sessionId);

      const ownerDelete = await send("DELETE", `/memory/${created.id}`, "owner-key", {});
      expect(ownerDelete.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  });

  it("protects episode deletion and raw-turn redaction with persisted session tenant", () => {
    const { db, service } = createTestService();
    const owner = {
      source: "codex", profileId: "default", userId: "same-person",
      projectId: "shared-project", tenantId: "tenant-A"
    };
    const other = { ...owner, tenantId: "tenant-B" };
    try {
      const session = service.openSession({
        requestId: "r2-tenant-open",
        adapterId: "r2-isolation",
        namespace: owner,
        sessionId: "r2-session-a"
      });
      const storedSession = db.db.prepare("SELECT meta_json FROM sessions WHERE id = ?").get(session.sessionId) as { meta_json: string };
      expect((JSON.parse(storedSession.meta_json) as { memmy_tenant_id?: string }).memmy_tenant_id).toBe("tenant-A");
      const turn = service.completeTurn("r2-protected-turn", {
        requestId: "r2-tenant-complete",
        adapterId: "r2-isolation",
        sessionId: session.sessionId,
        query: "Private tenant-A conversation",
        answer: "Tenant A answer",
        status: "succeeded"
      });
      expect(service.getMemory(turn.episodeId, { namespace: owner }).item).toBeTruthy();
      expect(() => service.getMemory(turn.episodeId, { namespace: other })).toThrow(/tenant/);
      expect(() => service.deletePanelTask(turn.episodeId, { namespace: other })).toThrow(/tenant/);
      expect(() => service.redactRawTurn(turn.rawTurnId, { namespace: other })).toThrow(/tenant/);
      expect(db.db.prepare("SELECT id FROM episodes WHERE id = ?").get(turn.episodeId)).toBeTruthy();
      const raw = db.db.prepare("SELECT redacted_at FROM raw_turns WHERE id = ?").get(turn.rawTurnId) as {redacted_at: string | null};
      expect(raw.redacted_at).toBeNull();
      expect(service.redactRawTurn(turn.rawTurnId, { namespace: owner }).ok).toBe(true);
      expect(service.deletePanelTask(turn.episodeId, { namespace: owner }).ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it("preserves original unscoped local cross-agent episode access", () => {
    const { db, service } = createTestService();
    try {
      const session = service.openSession({
        requestId: "r2-local-open",
        adapterId: "r2-local",
        namespace: { source: "claude_code", profileId: "default", userId: "owner-local" }
      });
      const turn = service.completeTurn("r2-local-turn", {
        requestId: "r2-local-complete",
        adapterId: "r2-local",
        sessionId: session.sessionId,
        query: "Local memory",
        answer: "Shared local memory",
        status: "succeeded"
      });
      expect(service.deletePanelTask(turn.episodeId, {
        namespace: { source: "codex", profileId: "default", userId: "other-local" }
      }).ok).toBe(true);
    } finally {
      db.close();
    }
  });
});
