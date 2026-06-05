import { describe, it, expect, beforeEach, vi } from "vitest";

// syncEngine straddles two worlds: the LOCAL side (IndexedDB stores + file blobs)
// and the CLOUD side (Supabase sync_records table + user-files bucket). We drive
// the local side with REAL fake-indexeddb (so getAccessor / fileStorage round-trip
// for real), and replace only the cloud seam — `./cloudClient` — with a stateful
// in-memory fake. That keeps the merge/quota/rollback logic under genuine test
// while staying offline-friendly.

interface Row {
  user_id: string;
  store: string;
  record_key: string;
  data: unknown;
  updated_at?: string;
}

const { cloud } = vi.hoisted(() => ({
  cloud: {
    rows: [] as Row[],
    bucket: new Map<string, { blob: Blob; created_at?: string }>(),
    docUpsertError: null as { message: string } | null,
    indexUpsertError: null as { message: string } | null,
    uploadError: null as { message: string } | null,
    removeError: null as { message: string } | null,
    deleteError: null as { message: string } | null,
    usage: null as
      | { documents_bytes: number; logs_bytes: number; snapshots_bytes: number; total_limit_bytes: number }
      | null,
  },
}));

vi.mock("./cloudClient", () => {
  const FILE_STORE = "files"; // = STORE_NAMES.FILES (guarded by an assertion in the suite)

  const syncRecords = () => {
    let op: "select" | "delete" | null = null;
    const filters: Record<string, string> = {};
    const builder = {
      upsert: (rows: Row[]) => {
        const isFile = rows.some((r) => r.store === FILE_STORE);
        const err = isFile ? cloud.indexUpsertError : cloud.docUpsertError;
        if (err) return Promise.resolve({ error: err });
        for (const r of rows) {
          const i = cloud.rows.findIndex(
            (x) => x.user_id === r.user_id && x.store === r.store && x.record_key === r.record_key,
          );
          const row = { ...r, updated_at: new Date().toISOString() };
          if (i >= 0) cloud.rows[i] = row;
          else cloud.rows.push(row);
        }
        return Promise.resolve({ error: null });
      },
      select: () => {
        op = "select";
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: (col: string, val: string) => {
        filters[col] = val;
        return builder;
      },
      then: (resolve: (v: unknown) => unknown) => {
        const matched = cloud.rows.filter((r) =>
          Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, string>)[k] === v),
        );
        if (op === "delete") {
          if (cloud.deleteError) return resolve({ error: cloud.deleteError });
          cloud.rows = cloud.rows.filter((r) => !matched.includes(r));
          return resolve({ error: null });
        }
        return resolve({ data: matched, error: null });
      },
    };
    return builder;
  };

  const userFiles = () => ({
    upload: (path: string, blob: Blob) => {
      if (cloud.uploadError) return Promise.resolve({ error: cloud.uploadError });
      cloud.bucket.set(path, { blob, created_at: new Date().toISOString() });
      return Promise.resolve({ error: null });
    },
    remove: (paths: string[]) => {
      if (cloud.removeError) return Promise.resolve({ error: cloud.removeError });
      paths.forEach((p) => cloud.bucket.delete(p));
      return Promise.resolve({ error: null });
    },
    list: (prefix: string) =>
      Promise.resolve({
        data: [...cloud.bucket.entries()]
          .filter(([k]) => k.startsWith(`${prefix}/`))
          .map(([k, v]) => ({ name: k.slice(prefix.length + 1), created_at: v.created_at })),
        error: null,
      }),
    download: (path: string) => {
      const hit = cloud.bucket.get(path);
      return Promise.resolve(hit ? { data: hit.blob, error: null } : { data: null, error: { message: "missing" } });
    },
  });

  return {
    SYNC_BUCKET: "user-files",
    syncRecords,
    userFiles,
    fetchStorageUsage: async () => cloud.usage,
    isQuotaError: (err: unknown) => err instanceof Error && /quota_exceeded/i.test(err.message),
  };
});

import { freshIndexedDB } from "@/lib/__test__/idb";
import { STORE_NAMES } from "@/lib/dbUtils";
import { FILE_STORE } from "./syncStores";
import { saveFile } from "@/lib/fileStorage";
import { getAccessor } from "./storeAccessors";
import { getFileRecord, fileSyncStatus } from "./fileSync";
import { pendingId } from "./merge";
import { setActiveUserId } from "./activeUser";
import {
  pushRecord,
  deleteRecord,
  reconcileDocs,
  pushFile,
  listCloudFiles,
  deleteCloudFile,
  downloadCloudFile,
  cleanupOrphanBlobs,
  getStorageUsage,
} from "./syncEngine";

const U = "user-1";

beforeEach(() => {
  freshIndexedDB();
  setActiveUserId(null);
  cloud.rows = [];
  cloud.bucket = new Map();
  cloud.docUpsertError = null;
  cloud.indexUpsertError = null;
  cloud.uploadError = null;
  cloud.removeError = null;
  cloud.deleteError = null;
  cloud.usage = null;
});

it("the fake's FILE_STORE matches the real one (guards the hardcoded literal)", () => {
  expect(FILE_STORE).toBe("files");
});

describe("pushRecord / deleteRecord", () => {
  it("upserts a local record to the cloud", async () => {
    await getAccessor(STORE_NAMES.KARTS).putOne({ id: "k1", name: "A", updatedAt: 5 });
    await pushRecord(U, STORE_NAMES.KARTS, "k1");
    expect(cloud.rows).toHaveLength(1);
    expect(cloud.rows[0]).toMatchObject({ user_id: U, store: STORE_NAMES.KARTS, record_key: "k1" });
  });

  it("is a no-op when the record is already gone locally", async () => {
    await pushRecord(U, STORE_NAMES.KARTS, "missing");
    expect(cloud.rows).toEqual([]);
  });

  it("throws on a backend upsert error", async () => {
    await getAccessor(STORE_NAMES.KARTS).putOne({ id: "k1", name: "A" });
    cloud.docUpsertError = { message: "db down" };
    await expect(pushRecord(U, STORE_NAMES.KARTS, "k1")).rejects.toThrow(/db down/);
  });

  it("deletes a cloud record", async () => {
    cloud.rows = [{ user_id: U, store: STORE_NAMES.KARTS, record_key: "k1", data: {} }];
    await deleteRecord(U, STORE_NAMES.KARTS, "k1");
    expect(cloud.rows).toEqual([]);
  });

  it("throws when the cloud delete fails", async () => {
    cloud.deleteError = { message: "nope" };
    await expect(deleteRecord(U, STORE_NAMES.KARTS, "k1")).rejects.toThrow(/nope/);
  });
});

describe("reconcileDocs", () => {
  it("pulls a cloud-only record down to local IndexedDB", async () => {
    cloud.rows = [
      { user_id: U, store: STORE_NAMES.KARTS, record_key: "k1", data: { id: "k1", name: "Cloud", updatedAt: 9 } },
    ];
    const result = await reconcileDocs(U, new Set());
    expect(result.pulled).toBe(1);
    expect(await getAccessor(STORE_NAMES.KARTS).getOne("k1")).toMatchObject({ name: "Cloud" });
  });

  it("pushes a local-only record up", async () => {
    await getAccessor(STORE_NAMES.KARTS).putOne({ id: "k1", name: "Local", updatedAt: 3 });
    const result = await reconcileDocs(U, new Set());
    expect(result.pushed).toBe(1);
    expect(cloud.rows).toHaveLength(1);
  });

  it("resolves a conflict last-write-wins by each record's updatedAt", async () => {
    // Local newer → push wins.
    await getAccessor(STORE_NAMES.KARTS).putOne({ id: "k1", name: "LocalNew", updatedAt: 20 });
    cloud.rows = [
      { user_id: U, store: STORE_NAMES.KARTS, record_key: "k1", data: { id: "k1", name: "CloudOld", updatedAt: 10 } },
    ];
    const result = await reconcileDocs(U, new Set());
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    expect(cloud.rows[0].data).toMatchObject({ name: "LocalNew" });
  });

  it("pulls when the cloud copy is newer", async () => {
    await getAccessor(STORE_NAMES.KARTS).putOne({ id: "k1", name: "LocalOld", updatedAt: 5 });
    cloud.rows = [
      { user_id: U, store: STORE_NAMES.KARTS, record_key: "k1", data: { id: "k1", name: "CloudNew", updatedAt: 50 } },
    ];
    const result = await reconcileDocs(U, new Set());
    expect(result.pulled).toBe(1);
    expect(await getAccessor(STORE_NAMES.KARTS).getOne("k1")).toMatchObject({ name: "CloudNew" });
  });

  it("forces a push for a pending key even when the cloud copy is newer", async () => {
    await getAccessor(STORE_NAMES.KARTS).putOne({ id: "k1", name: "LocalPending", updatedAt: 1 });
    cloud.rows = [
      { user_id: U, store: STORE_NAMES.KARTS, record_key: "k1", data: { id: "k1", name: "CloudNew", updatedAt: 99 } },
    ];
    // Pending wins over the timestamp comparison, even though the cloud copy is newer.
    const result = await reconcileDocs(U, new Set([pendingId(STORE_NAMES.KARTS, "k1")]));
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    expect(cloud.rows[0].data).toMatchObject({ name: "LocalPending" });
  });

  it("partial-pushes under quota pressure: saves what fits, skips the rest, never throws", async () => {
    await getAccessor(STORE_NAMES.KARTS).putOne({ id: "k1", name: "A" });
    cloud.docUpsertError = { message: "quota_exceeded" };
    const result = await reconcileDocs(U, new Set());
    expect(result.skipped).toBe(1);
    expect(result.pushed).toBe(0);
  });

  it("rethrows a non-quota push error", async () => {
    await getAccessor(STORE_NAMES.KARTS).putOne({ id: "k1", name: "A" });
    cloud.docUpsertError = { message: "disk on fire" };
    await expect(reconcileDocs(U, new Set())).rejects.toThrow(/disk on fire/);
  });
});

describe("file blob sync", () => {
  it("uploads the blob, writes the index row, and marks the file synced", async () => {
    await saveFile("run1.dove", new Blob(["abcde"]));
    await pushFile(U, "run1.dove");
    expect(cloud.bucket.has(`${U}/run1.dove`)).toBe(true);
    expect(cloud.rows.some((r) => r.store === FILE_STORE && r.record_key === "run1.dove")).toBe(true);
    expect(fileSyncStatus(await getFileRecord("run1.dove"))).toBe("synced");
  });

  it("throws when the file isn't stored locally", async () => {
    await expect(pushFile(U, "ghost.dove")).rejects.toThrow(/not found locally/i);
  });

  it("rolls the blob back if the index row is rejected (no bucket orphan)", async () => {
    await saveFile("run1.dove", new Blob(["abcde"]));
    cloud.indexUpsertError = { message: "quota_exceeded" };
    await expect(pushFile(U, "run1.dove")).rejects.toThrow(/Failed to index/);
    expect(cloud.bucket.has(`${U}/run1.dove`)).toBe(false);
  });

  it("lists cloud files from their index rows", async () => {
    cloud.rows = [
      { user_id: U, store: FILE_STORE, record_key: "run1.dove", data: { size: 5 }, updated_at: "2026-01-01T00:00:00Z" },
      { user_id: U, store: STORE_NAMES.KARTS, record_key: "k1", data: {} }, // ignored (not a file row)
    ];
    const files = await listCloudFiles(U);
    expect(files).toEqual([{ name: "run1.dove", size: 5, uploadedAt: "2026-01-01T00:00:00Z" }]);
  });

  it("deletes the cloud blob and its index row", async () => {
    cloud.bucket.set(`${U}/run1.dove`, { blob: new Blob(["x"]) });
    cloud.rows = [{ user_id: U, store: FILE_STORE, record_key: "run1.dove", data: { size: 1 } }];
    await deleteCloudFile(U, "run1.dove");
    expect(cloud.bucket.has(`${U}/run1.dove`)).toBe(false);
    expect(cloud.rows).toEqual([]);
  });

  it("downloads a cloud blob, or returns null when absent", async () => {
    cloud.bucket.set(`${U}/run1.dove`, { blob: new Blob(["abc"]) });
    expect(await downloadCloudFile(U, "run1.dove")).toBeInstanceOf(Blob);
    expect(await downloadCloudFile(U, "missing.dove")).toBeNull();
  });
});

describe("cleanupOrphanBlobs", () => {
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago (past the grace window)
  const fresh = new Date().toISOString();

  it("removes an aged blob that has no index row", async () => {
    cloud.bucket.set(`${U}/orphan.dove`, { blob: new Blob(["x"]), created_at: old });
    const removed = await cleanupOrphanBlobs(U);
    expect(removed).toBe(1);
    expect(cloud.bucket.has(`${U}/orphan.dove`)).toBe(false);
  });

  it("keeps a blob that still has an index row", async () => {
    cloud.bucket.set(`${U}/run1.dove`, { blob: new Blob(["x"]), created_at: old });
    cloud.rows = [{ user_id: U, store: FILE_STORE, record_key: "run1.dove", data: { size: 1 } }];
    expect(await cleanupOrphanBlobs(U)).toBe(0);
    expect(cloud.bucket.has(`${U}/run1.dove`)).toBe(true);
  });

  it("spares a recently-uploaded blob (TOCTOU grace window)", async () => {
    cloud.bucket.set(`${U}/inflight.dove`, { blob: new Blob(["x"]), created_at: fresh });
    expect(await cleanupOrphanBlobs(U)).toBe(0);
    expect(cloud.bucket.has(`${U}/inflight.dove`)).toBe(true);
  });
});

describe("getStorageUsage", () => {
  it("maps the server's pooled-usage row", async () => {
    cloud.usage = { documents_bytes: 10, logs_bytes: 20, snapshots_bytes: 5, total_limit_bytes: 1000 };
    expect(await getStorageUsage()).toEqual({ documents: 10, logs: 20, snapshots: 5, totalLimit: 1000 });
  });

  it("falls back to zeros + the advisory free limit when the server has no row", async () => {
    cloud.usage = null;
    const usage = await getStorageUsage();
    expect(usage.documents).toBe(0);
    expect(usage.totalLimit).toBeGreaterThan(0);
  });
});
