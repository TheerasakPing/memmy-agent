import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHttpServer } from "../../src/index.js";
import { createMemoryServiceFixture } from "../fixtures/memory-service-fixture.js";

const { cleanup, createTestService } = createMemoryServiceFixture();
afterEach(cleanup);

describe("R2 memory search privacy: recordEvent=false", () => {
  it("does not insert a recall event when search opts out, but preserves default recording", async () => {
    const { db, service } = createTestService();
    const server = createMemoryHttpServer({
      service,
      auth: { localServiceToken: "r2-private-memory-test-token" }
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("expected local memory test server port");
      }
      const endpoint = `http://127.0.0.1:${address.port}/api/v1/memory/search`;
      const countEvents = () => (
        db.db.prepare("SELECT COUNT(*) AS count FROM recall_events").get() as { count: number }
      ).count;
      const query = async (requestId: string, recordEvent?: boolean) => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: "Bearer r2-private-memory-test-token",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            requestId,
            adapterId: "r2-search-privacy",
            query: "Search for example project notes",
            layers: ["L1"],
            ...(recordEvent === undefined ? {} : { recordEvent })
          })
        });
        expect(response.status).toBe(200);
        return response.json();
      };

      const before = countEvents();
      await query("r2-search-without-recording", false);
      expect(countEvents()).toBe(before);
      await query("r2-default-search-with-recording");
      expect(countEvents()).toBe(before + 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  });
});
