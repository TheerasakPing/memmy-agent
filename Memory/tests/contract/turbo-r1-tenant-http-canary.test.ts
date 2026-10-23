import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHttpServer } from "../../src/index.js";
import { createMemoryServiceFixture } from "../fixtures/memory-service-fixture.js";

const { cleanup, createTestService } = createMemoryServiceFixture();
afterEach(cleanup);

/**
 * This suite records expected authorization failures in the v1.2.4 baseline.
 * it.fails(...) means the security expectation is NOT enforced yet, and a
 * passing XFAIL should never be interpreted as tenant isolation being fixed.
 * Use isolated SQLite fixture only; never touch the user's real memory DB.
 */
describe("R1 HTTP scoped tenant access KNOWN-FAILURE canaries", () => {
  async function withTenantServer(run: (baseUrl: string) => Promise<void>) {
    const { db, service } = createTestService();
    const server = createMemoryHttpServer({
      service,
      auth: {
        scopedApiKeys: {
          "writer-tenant-a": {
            namespace: {
              source: "codex", profileId: "default",
              userId: "r1-http-user-a", tenantId: "r1-http-tenant-a"
            },
            scopes: ["memory:read", "memory:write"]
          },
          "reader-tenant-b": {
            namespace: {
              source: "codex", profileId: "default",
              userId: "r1-http-user-b", tenantId: "r1-http-tenant-b"
            },
            scopes: ["memory:read"]
          },
          "writer-tenant-b": {
            namespace: {
              source: "codex", profileId: "default",
              userId: "r1-http-user-b", tenantId: "r1-http-tenant-b"
            },
            scopes: ["memory:read", "memory:write"]
          }
        }
      }
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing port");
      await run(`http://127.0.0.1:${address.port}/api/v1`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  }

  async function createTenantMemory(baseUrl: string) {
    const response = await fetch(`${baseUrl}/memory/add`, {
      method: "POST",
      headers: {
        authorization: "Bearer writer-tenant-a",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        adapterId: "r1-tenant-test",
        requestId: "r1-tenant-http-memory",
        content: "Sensitive tenant A only",
        layer: "L2",
        deferProcessing: true
      })
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { id: string };
    expect(result.id).toBeTruthy();
    return result.id;
  }

  it.fails("SEC-03: tenant-B scoped reader must not GET tenant-A memory", async () => {
    await withTenantServer(async (baseUrl) => {
      const id = await createTenantMemory(baseUrl);
      const response = await fetch(`${baseUrl}/memory/${id}`, {
        headers: { authorization: "Bearer reader-tenant-b" }
      });
      expect([403, 404]).toContain(response.status);
    });
  });

  it.fails("SEC-04: tenant-B scoped writer must not DELETE tenant-A memory", async () => {
    await withTenantServer(async (baseUrl) => {
      const id = await createTenantMemory(baseUrl);
      const response = await fetch(`${baseUrl}/memory/${id}`, {
        method: "DELETE",
        headers: {
          authorization: "Bearer writer-tenant-b",
          "content-type": "application/json"
        },
        body: JSON.stringify({ reason: "R1 cross-tenant negative fixture" })
      });
      expect([403, 404]).toContain(response.status);
    });
  });
});
