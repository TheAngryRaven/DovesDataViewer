/**
 * IndexedDB CRUD tests for lapSnapshotStorage. Covers the round-trip, the
 * courseKey-indexed query (fastest-first), newest-first listing, the
 * event-emitting `saveSnapshot` vs the silent `putSnapshotRaw` (cloud-pull path),
 * and that a local delete still emits a garage event.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  listSnapshots,
  listSnapshotsForCourse,
  getSnapshot,
  saveSnapshot,
  putSnapshotRaw,
  deleteSnapshot,
} from "./lapSnapshotStorage";
import type { LapSnapshot } from "./lapSnapshot";
import type { Course } from "@/types/racing";
import { onGarageChange } from "./garageEvents";

beforeEach(() => freshIndexedDB());

const course: Course = {
  name: "CW",
  startFinishA: { lat: 28.4, lon: -81.4 },
  startFinishB: { lat: 28.4, lon: -81.399 },
};

function snap(id: string, opts: Partial<LapSnapshot> = {}): LapSnapshot {
  return {
    id,
    trackName: "OKC",
    courseName: "CW",
    courseKey: "okc:cw",
    engine: "X30",
    engineKey: "x30",
    course,
    lapTimeMs: 62000,
    sourceFileName: "s.dove",
    sourceLapNumber: 1,
    samples: [],
    lapStartMs: 0,
    lapEndMs: 62000,
    createdAt: 1,
    updatedAt: 1,
    ...opts,
  };
}

describe("lapSnapshotStorage CRUD", () => {
  it("saves and reads a snapshot by id", async () => {
    await saveSnapshot(snap("snap1"));
    expect(await getSnapshot("snap1")).toMatchObject({ id: "snap1", engine: "X30" });
  });

  it("returns null for a missing snapshot", async () => {
    expect(await getSnapshot("none")).toBeNull();
  });

  it("lists snapshots newest-first by updatedAt", async () => {
    // putSnapshotRaw preserves updatedAt (saveSnapshot re-stamps to now), so use
    // it to pin deterministic timestamps and assert the sort order.
    await putSnapshotRaw(snap("a", { updatedAt: 100 }));
    await putSnapshotRaw(snap("b", { updatedAt: 300 }));
    await putSnapshotRaw(snap("c", { updatedAt: 200 }));
    expect((await listSnapshots()).map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("returns course snapshots fastest-first via the courseKey index", async () => {
    await saveSnapshot(snap("slow", { courseKey: "okc:cw", lapTimeMs: 63000 }));
    await saveSnapshot(snap("fast", { courseKey: "okc:cw", lapTimeMs: 61000 }));
    await saveSnapshot(snap("other", { courseKey: "bmp:cw", lapTimeMs: 60000 }));
    const forCourse = await listSnapshotsForCourse("okc:cw");
    expect(forCourse.map((s) => s.id)).toEqual(["fast", "slow"]);
  });

  it("deletes a snapshot", async () => {
    await saveSnapshot(snap("snap1"));
    await deleteSnapshot("snap1");
    expect(await getSnapshot("snap1")).toBeNull();
  });
});

describe("lapSnapshotStorage events", () => {
  it("saveSnapshot emits a put; deleteSnapshot emits a delete", async () => {
    const seen = vi.fn();
    const off = onGarageChange(seen);
    await saveSnapshot(snap("snap1"));
    await deleteSnapshot("snap1");
    off();
    expect(seen).toHaveBeenNthCalledWith(1, { store: "lap-snapshots", key: "snap1", type: "put" });
    expect(seen).toHaveBeenNthCalledWith(2, { store: "lap-snapshots", key: "snap1", type: "delete" });
  });

  it("putSnapshotRaw writes WITHOUT emitting an event (cloud-pull path) or re-stamping", async () => {
    const seen = vi.fn();
    const off = onGarageChange(seen);
    await putSnapshotRaw(snap("pulled", { updatedAt: 42 }));
    off();
    expect(seen).not.toHaveBeenCalled();
    // updatedAt is preserved exactly (not re-stamped to Date.now()).
    expect((await getSnapshot("pulled"))!.updatedAt).toBe(42);
  });
});
