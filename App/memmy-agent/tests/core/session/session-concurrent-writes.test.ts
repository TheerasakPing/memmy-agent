import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../../../src/core/session/manager.js";

const roots: string[] = [];
function isolatedManager() {
  const root = mkdtempSync(join(tmpdir(), "memmy-r8-concurrent-session-"));
  roots.push(root);
  return new SessionManager(join(root, "sessions"));
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("R8 Session concurrent persistence/recovery", () => {
  it("supports many overlapping asynchronous saves for the same chat without temporary-file conflicts", async () => {
    const manager = isolatedManager();
    const session = manager.getOrCreate("websocket:r8-concurrent");
    session.addMessage("user", "request");
    await Promise.all(Array.from({ length: 16 }, (_, i) => {
      session.addMessage("assistant", "response-" + i);
      return manager.saveAsync(session);
    }));
    const restored = new SessionManager(manager.root).getOrCreate(session.key);
    expect(restored.messages).toHaveLength(17);
    expect(restored.messages.at(-1)?.content).toBe("response-15");
    expect(readdirSync(manager.root).filter(x => x.endsWith(".tmp"))).toEqual([]);
  });
  it("does not let an old asynchronous snapshot overwrite a newer synchronous save", async () => {
    const manager = isolatedManager();
    const session = manager.getOrCreate("websocket:r8-latest");
    session.addMessage("user", "first");
    const pending = manager.saveAsync(session);
    session.addMessage("assistant", "newer");
    manager.save(session, { fsync: true });
    await pending;
    expect(new SessionManager(manager.root).getOrCreate(session.key).messages.map(m => m.content))
      .toEqual(["first", "newer"]);
    expect(readdirSync(manager.root).filter(x => x.endsWith(".tmp"))).toEqual([]);
  });

  it("does not recreate a hard-deleted chat when pending async writes finish", async () => {
    const manager = isolatedManager();
    const key = "websocket:r8-removed";
    const session = manager.getOrCreate(key);
    session.addMessage("user", "delete me");
    manager.save(session);
    const outstanding = Array.from({ length: 12 }, () => manager.saveAsync(session));
    expect(manager.hardDeleteSession(key)).toBe(true);
    await Promise.allSettled(outstanding);
    expect(new SessionManager(manager.root).get(key)).toBeNull();
    expect(manager.get(key)).toBeNull();
  });

  it("preserves independent chats after concurrent disk saves and restart", async () => {
    const manager = isolatedManager();
    const sessions = Array.from({ length: 48 }, (_, i) => {
      const session = manager.getOrCreate("websocket:r8-multi-" + i);
      session.addMessage("user", "prompt-" + i);
      session.addMessage("assistant", "answer-" + i);
      return session;
    });
    await Promise.all(sessions.map(session => manager.saveAsync(session)));
    const restarted = new SessionManager(manager.root);
    expect(restarted.listSessions()).toHaveLength(48);
    for (const [i, session] of sessions.entries()) {
      expect(restarted.getOrCreate(session.key).messages.map(m => m.content))
        .toEqual(["prompt-" + i, "answer-" + i]);
    }
  });
});
