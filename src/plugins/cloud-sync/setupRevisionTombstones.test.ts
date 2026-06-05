import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stand-in for the IndexedDB-backed plugin KV — see pendingSync.test.ts.
const { kv } = vi.hoisted(() => ({ kv: new Map<string, unknown>() }));

vi.mock("@/plugins/storage", () => ({
  getPluginStore: () => ({
    get: async <T>(k: string): Promise<T | undefined> => kv.get(k) as T | undefined,
    set: async <T>(k: string, v: T): Promise<void> => {
      kv.set(k, v);
    },
    delete: async (k: string): Promise<void> => {
      kv.delete(k);
    },
    getAll: async <T>(): Promise<T[]> => [...kv.values()] as T[],
    keys: async (): Promise<string[]> => [...kv.keys()],
  }),
}));

import {
  addSetupRevisionTombstone,
  clearSetupRevisionTombstone,
  setupRevisionTombstoneSet,
  isSetupRevisionTombstoned,
} from "./setupRevisionTombstones";
import { setActiveUserId } from "./activeUser";

beforeEach(() => {
  kv.clear();
  setActiveUserId(null);
});

describe("setup-revision tombstones", () => {
  it("records a pruned orphan so reconcile skips re-pulling it", async () => {
    await addSetupRevisionTombstone("hash-abc");
    expect(await setupRevisionTombstoneSet()).toEqual(new Set(["hash-abc"]));
    expect(await isSetupRevisionTombstoned("hash-abc")).toBe(true);
    expect(await isSetupRevisionTombstoned("hash-xyz")).toBe(false);
  });

  it("is idempotent on repeated adds", async () => {
    await addSetupRevisionTombstone("hash-abc");
    await addSetupRevisionTombstone("hash-abc");
    expect([...(await setupRevisionTombstoneSet())]).toEqual(["hash-abc"]);
  });

  it("clears a tombstone when the revision is wanted again (re-frozen)", async () => {
    await addSetupRevisionTombstone("hash-abc");
    await clearSetupRevisionTombstone("hash-abc");
    expect(await isSetupRevisionTombstoned("hash-abc")).toBe(false);
  });

  it("partitions tombstones per user so one device's prune can't suppress another's revisions", async () => {
    setActiveUserId("user-a");
    await addSetupRevisionTombstone("hash-abc");

    setActiveUserId("user-b");
    expect(await isSetupRevisionTombstoned("hash-abc")).toBe(false);

    setActiveUserId("user-a");
    expect(await isSetupRevisionTombstoned("hash-abc")).toBe(true);
  });
});
