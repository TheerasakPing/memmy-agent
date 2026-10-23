import { afterEach, describe, expect, it } from "vitest";
import { createMemoryServiceFixture } from "../fixtures/memory-service-fixture.js";

/**
 * R1 security audit: these are KNOWN-FAILURE canaries, not passing authorization
 * guarantees. Vitest's it.fails means the negative security assertion is expected
 * to fail on the pinned 1.2.4 baseline. Convert them to it(...) only when
 * isolation is implemented and independently verified in R2.
 *
 * IMPORTANT: Never run against an actual ~/.memmy database. The fixture creates
 * an isolated temporary database and closes it after every test.
 */
const { cleanup, createTestService } = createMemoryServiceFixture();
afterEach(cleanup);

const ownerNamespace = {
  source: "codex",
  profileId: "default",
  userId: "r1-alice",
  projectId: "r1-project-a",
  tenantId: "r1-tenant-a"
};
const otherNamespace = {
  source: "codex",
  profileId: "default",
  userId: "r1-bob",
  projectId: "r1-project-b",
  tenantId: "r1-tenant-b"
};

describe("R1 known-failure security canaries (XFAIL, do not interpret as fixed)", () => {
  it.fails("SEC-01: cross-tenant episode deletion must fail before mutation", () => {
    const { db, service } = createTestService();
    try {
      const session = service.openSession({
        requestId: "r1-episode-open",
        adapterId: "r1-isolation",
        namespace: ownerNamespace,
        sessionId: "r1-episode-owner"
      });
      const turn = service.completeTurn("r1-episode-turn", {
        requestId: "r1-episode-complete",
        adapterId: "r1-isolation",
        sessionId: session.sessionId,
        query: "Owner-only episode",
        answer: "Private project result",
        status: "succeeded"
      });
      expect(() => service.deletePanelTask(turn.episodeId, {
        namespace: otherNamespace
      })).toThrow(/forbidden|not_found|different (user|tenant|project|namespace)/i);
    } finally {
      db.close();
    }
  });

  it.fails("SEC-02: cross-tenant raw-turn redaction must fail before mutation", () => {
    const { db, service } = createTestService();
    try {
      const session = service.openSession({
        requestId: "r1-raw-open",
        adapterId: "r1-isolation",
        namespace: ownerNamespace,
        sessionId: "r1-raw-owner"
      });
      const turn = service.completeTurn("r1-raw-turn", {
        requestId: "r1-raw-complete",
        adapterId: "r1-isolation",
        sessionId: session.sessionId,
        query: "Sensitive owner-only turn",
        answer: "Not intended for another tenant",
        status: "succeeded"
      });
      expect(() => service.redactRawTurn(turn.rawTurnId, {
        namespace: otherNamespace,
        reason: "R1 isolation negative test"
      })).toThrow(/forbidden|not_found|different (user|tenant|project|namespace)/i);
    } finally {
      db.close();
    }
  });
});
