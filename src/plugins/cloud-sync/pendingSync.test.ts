import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stand-in for the plugin KV (getPluginStore is IndexedDB-backed). The
// map is hoisted so the vi.mock factory can close over it; tests reset it between
// cases. This keeps pendingSync's offline-queue logic testable in a node env
// without touching real IndexedDB.
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
  markPending,
  clearPending,
  listPending,
  pendingCount,
  pendingKeySet,
} from "./pendingSync";
import { pendingId } from "./merge";
import { setActiveUserId } from "./activeUser";

beforeEach(() => {
  kv.clear();
  setActiveUserId(null);
});

describe("markPending", () => {
  it("queues a new pending change", async () => {
    await markPending({ store: "notes", key: "n1", type: "put" });
    expect(await listPending()).toEqual([{ store: "notes", key: "n1", type: "put" }]);
    expect(await pendingCount()).toBe(1);
  });

  it("keeps the latest op for a key (a put then delete collapses to one delete)", async () => {
    await markPending({ store: "notes", key: "n1", type: "put" });
    await markPending({ store: "notes", key: "n1", type: "delete" });
    expect(await listPending()).toEqual([{ store: "notes", key: "n1", type: "delete" }]);
    expect(await pendingCount()).toBe(1);
  });

  it("tracks distinct (store, key) pairs separately", async () => {
    await markPending({ store: "notes", key: "n1", type: "put" });
    await markPending({ store: "notes", key: "n2", type: "put" });
    await markPending({ store: "karts", key: "n1", type: "put" });
    expect(await pendingCount()).toBe(3);
  });
});

describe("clearPending", () => {
  it("drops only the confirmed (store, key) entry", async () => {
    await markPending({ store: "notes", key: "n1", type: "put" });
    await markPending({ store: "notes", key: "n2", type: "put" });
    await clearPending("notes", "n1");
    expect(await listPending()).toEqual([{ store: "notes", key: "n2", type: "put" }]);
  });

  it("is a no-op when nothing matches", async () => {
    await markPending({ store: "notes", key: "n1", type: "put" });
    await clearPending("notes", "missing");
    expect(await pendingCount()).toBe(1);
  });
});

describe("pendingKeySet", () => {
  it("maps each pending change to its reconcile pendingId", async () => {
    await markPending({ store: "notes", key: "n1", type: "put" });
    await markPending({ store: "karts", key: "k9", type: "delete" });
    const set = await pendingKeySet();
    expect(set).toEqual(
      new Set([pendingId("notes", "n1"), pendingId("karts", "k9")]),
    );
  });
});

describe("per-user partition", () => {
  it("never flushes one account's queue into another's", async () => {
    setActiveUserId("user-a");
    await markPending({ store: "notes", key: "n1", type: "put" });

    setActiveUserId("user-b");
    expect(await listPending()).toEqual([]);
    await markPending({ store: "notes", key: "n2", type: "put" });
    expect(await pendingCount()).toBe(1);

    setActiveUserId("user-a");
    expect(await listPending()).toEqual([{ store: "notes", key: "n1", type: "put" }]);
  });
});
