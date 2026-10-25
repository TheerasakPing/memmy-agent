import { describe, expect, it, vi } from "vitest";
import { getMemoryHealth } from "../bootstrap-service.js";
import type { MemoryClient } from "../../adapters/outbound/memory-client/index.js";

describe("Bootstrap Memory health", () => {
  it("does not hold startup waiting forever on a busy legacy Memory service", async () => {
    vi.useFakeTimers();
    try {
      const stuck = { health: () => new Promise<never>(() => undefined) } as unknown as MemoryClient;
      const result = getMemoryHealth(stuck);
      await vi.advanceTimersByTimeAsync(3500);
      await expect(result).resolves.toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
  it("preserves healthy Memory state when the service replies promptly", async () => {
    const healthy = { health: async () => ({ ok: true }) } as unknown as MemoryClient;
    await expect(getMemoryHealth(healthy)).resolves.toBe("ok");
  });
});
