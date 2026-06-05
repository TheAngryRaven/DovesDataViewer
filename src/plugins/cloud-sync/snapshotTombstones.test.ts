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
  addSnapshotTombstone,
  clearSnapshotTombstone,
  snapshotTombstoneSet,
} from "./snapshotTombstones";
import { setActiveUserId } from "./activeUser";

beforeEach(() => {
  kv.clear();
  setActiveUserId(null);
});

describe("snapshot tombstones", () => {
  it("records a cloud-deleted id so reconcile won't resurrect it", async () => {
    await addSnapshotTombstone("snap-1");
    expect(await snapshotTombstoneSet()).toEqual(new Set(["snap-1"]));
  });

  it("is idempotent — adding the same id twice keeps one entry", async () => {
    await addSnapshotTombstone("snap-1");
    await addSnapshotTombstone("snap-1");
    expect([...(await snapshotTombstoneSet())]).toEqual(["snap-1"]);
  });

  it("clears a tombstone (e.g. when the snapshot is saved again)", async () => {
    await addSnapshotTombstone("snap-1");
    await addSnapshotTombstone("snap-2");
    await clearSnapshotTombstone("snap-1");
    expect(await snapshotTombstoneSet()).toEqual(new Set(["snap-2"]));
  });

  it("treats clearing a missing id as a no-op", async () => {
    await addSnapshotTombstone("snap-1");
    await clearSnapshotTombstone("nope");
    expect(await snapshotTombstoneSet()).toEqual(new Set(["snap-1"]));
  });

  it("partitions tombstones per user so one account's delete can't suppress another's push", async () => {
    setActiveUserId("user-a");
    await addSnapshotTombstone("snap-1");

    setActiveUserId("user-b");
    expect(await snapshotTombstoneSet()).toEqual(new Set());

    setActiveUserId("user-a");
    expect(await snapshotTombstoneSet()).toEqual(new Set(["snap-1"]));
  });
});
