import { describe, it, expect, beforeEach, vi } from "vitest";

// Minimal snapshot shape the sync logic actually reads (id + keys + updatedAt).
interface LocalSnap {
  id: string;
  courseKey: string;
  engineKey: string;
  updatedAt: number;
}

// Test-controlled backing state for the mocked storage + cloud + tombstone deps.
const { state } = vi.hoisted(() => ({
  state: {
    local: [] as LocalSnap[],
    cloudRows: [] as { course_key: string; engine_key: string; data: LocalSnap; updated_at?: string }[],
    tombstones: new Set<string>(),
    upserts: [] as Record<string, unknown>[],
    deletes: 0,
    upsertError: null as { message: string } | null,
    deleteError: null as { message: string } | null,
    putRaw: [] as LocalSnap[],
  },
}));

vi.mock("@/lib/lapSnapshotStorage", () => ({
  getSnapshot: async (id: string) => state.local.find((s) => s.id === id) ?? null,
  listSnapshots: async () => state.local,
  putSnapshotRaw: async (snap: LocalSnap) => {
    state.putRaw.push(snap);
  },
}));

vi.mock("./cloudClient", () => {
  const table = () => {
    let isDelete = false;
    const builder = {
      select: () => builder,
      eq: () => builder,
      delete: () => {
        isDelete = true;
        return builder;
      },
      upsert: (rows: Record<string, unknown>[]) => {
        state.upserts.push(...rows);
        return Promise.resolve({ error: state.upsertError });
      },
      then: (onFulfilled: (v: unknown) => unknown) => {
        if (isDelete) {
          state.deletes++;
          return onFulfilled({ error: state.deleteError });
        }
        return onFulfilled({ data: state.cloudRows, error: null });
      },
    };
    return builder;
  };
  return {
    lapSnapshotsTable: table,
    isQuotaError: (err: unknown) => err instanceof Error && /quota_exceeded/i.test(err.message),
  };
});

vi.mock("./snapshotTombstones", () => ({
  snapshotTombstoneSet: async () => state.tombstones,
  addSnapshotTombstone: async (id: string) => {
    state.tombstones.add(id);
  },
  clearSnapshotTombstone: async (id: string) => {
    state.tombstones.delete(id);
  },
}));

import { pushSnapshot, deleteCloudSnapshot, reconcileSnapshots } from "./snapshotSync";
import type { LapSnapshot } from "@/lib/lapSnapshot";

const snap = (id: string, updatedAt: number, course = "c1", engine = "e1"): LocalSnap => ({
  id,
  courseKey: course,
  engineKey: engine,
  updatedAt,
});

beforeEach(() => {
  state.local = [];
  state.cloudRows = [];
  state.tombstones = new Set();
  state.upserts = [];
  state.deletes = 0;
  state.upsertError = null;
  state.deleteError = null;
  state.putRaw = [];
});

describe("pushSnapshot", () => {
  it("upserts the local snapshot keyed by user/course/engine", async () => {
    state.local = [snap("s1", 100, "course-a", "engine-b")];
    await pushSnapshot("u1", "s1");
    expect(state.upserts).toEqual([
      {
        user_id: "u1",
        course_key: "course-a",
        engine_key: "engine-b",
        data: state.local[0],
      },
    ]);
  });

  it("is a no-op for a tombstoned id (won't resurrect a cloud-deleted snapshot)", async () => {
    state.local = [snap("s1", 100)];
    state.tombstones.add("s1");
    await pushSnapshot("u1", "s1");
    expect(state.upserts).toEqual([]);
  });

  it("is a no-op when the snapshot is gone locally", async () => {
    await pushSnapshot("u1", "missing");
    expect(state.upserts).toEqual([]);
  });

  it("throws when the upsert fails", async () => {
    state.local = [snap("s1", 100)];
    state.upsertError = { message: "write failed" };
    await expect(pushSnapshot("u1", "s1")).rejects.toThrow(/write failed/);
  });
});

describe("deleteCloudSnapshot", () => {
  it("deletes the cloud row and tombstones the id so reconcile won't re-push", async () => {
    await deleteCloudSnapshot("u1", snap("s1", 100) as unknown as LapSnapshot);
    expect(state.deletes).toBe(1);
    expect(state.tombstones.has("s1")).toBe(true);
  });

  it("throws and does NOT tombstone when the delete fails", async () => {
    state.deleteError = { message: "nope" };
    await expect(
      deleteCloudSnapshot("u1", snap("s1", 100) as unknown as LapSnapshot),
    ).rejects.toThrow(/nope/);
    expect(state.tombstones.has("s1")).toBe(false);
  });
});

describe("reconcileSnapshots", () => {
  it("pulls a cloud-only snapshot down (additive)", async () => {
    state.cloudRows = [{ course_key: "c1", engine_key: "e1", data: snap("s1", 200) }];
    const result = await reconcileSnapshots("u1");
    expect(state.putRaw.map((s) => s.id)).toEqual(["s1"]);
    expect(result.pulled).toBe(1);
    expect(result.pushed).toBe(0);
  });

  it("pulls only when the cloud copy is newer, leaving a fresher local copy alone", async () => {
    state.local = [snap("s1", 300)];
    state.cloudRows = [{ course_key: "c1", engine_key: "e1", data: snap("s1", 100) }];
    const result = await reconcileSnapshots("u1");
    expect(state.putRaw).toEqual([]);
    expect(result.pulled).toBe(0);
    // cloud copy is older, so the local copy is pushed up instead.
    expect(result.pushed).toBe(1);
  });

  it("pushes a local-only snapshot up", async () => {
    state.local = [snap("s1", 100)];
    const result = await reconcileSnapshots("u1");
    expect(state.upserts).toHaveLength(1);
    expect(result.pushed).toBe(1);
  });

  it("never pushes a tombstoned local snapshot", async () => {
    state.local = [snap("s1", 100)];
    state.tombstones.add("s1");
    const result = await reconcileSnapshots("u1");
    expect(state.upserts).toEqual([]);
    expect(result.pushed).toBe(0);
  });

  it("skips a push the server rejects for quota instead of throwing", async () => {
    state.local = [snap("s1", 100)];
    state.upsertError = { message: "quota_exceeded" };
    const result = await reconcileSnapshots("u1");
    expect(result.skipped).toBe(1);
    expect(result.pushed).toBe(0);
  });

  it("rethrows a non-quota push error", async () => {
    state.local = [snap("s1", 100)];
    state.upsertError = { message: "disk on fire" };
    await expect(reconcileSnapshots("u1")).rejects.toThrow(/disk on fire/);
  });
});
