import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "@/lib/__test__/idb";
import { STORE_NAMES } from "@/lib/dbUtils";
import { saveFile } from "@/lib/fileStorage";
import { putSnapshotRaw } from "@/lib/lapSnapshotStorage";
import type { LapSnapshot } from "@/lib/lapSnapshot";
import { getAccessor } from "./storeAccessors";
import { getLocalStorageUsage } from "./localUsage";
import { LOCAL_ADVISORY_LIMIT } from "./storageTypes";

beforeEach(() => freshIndexedDB());

const snapshot = (id: string): LapSnapshot =>
  ({
    id,
    courseKey: "c1",
    engineKey: "e1",
    lapTimeMs: 60000,
    samples: [],
    updatedAt: 1,
  }) as unknown as LapSnapshot;

describe("getLocalStorageUsage", () => {
  it("reports all three segments at zero on an empty device", async () => {
    const usage = await getLocalStorageUsage();
    expect(usage.documents).toBe(0);
    expect(usage.logs).toBe(0);
    expect(usage.snapshots).toBe(0);
    expect(usage.totalLimit).toBeGreaterThan(0);
  });

  it("draws the bar against the fixed local advisory limit", async () => {
    // The device's real free space isn't exposed, so the local meter always uses
    // the advisory marker as its denominator regardless of what's stored.
    expect((await getLocalStorageUsage()).totalLimit).toBe(LOCAL_ADVISORY_LIMIT);
    await saveFile("run1.dove", new Blob(["abcde"]));
    expect((await getLocalStorageUsage()).totalLimit).toBe(LOCAL_ADVISORY_LIMIT);
  });

  it("sums log blob sizes exactly", async () => {
    await saveFile("run1.dove", new Blob(["abcde"])); // 5 bytes
    await saveFile("run2.dove", new Blob(["xyz"])); // 3 bytes
    const usage = await getLocalStorageUsage();
    expect(usage.logs).toBe(8);
  });

  it("counts garage documents from the synced doc stores", async () => {
    await getAccessor(STORE_NAMES.NOTES).putOne({ id: "n1", fileName: "f", text: "hello" });
    const usage = await getLocalStorageUsage();
    expect(usage.documents).toBeGreaterThan(0);
    // The other two segments stay empty — documents are accounted separately.
    expect(usage.logs).toBe(0);
    expect(usage.snapshots).toBe(0);
  });

  it("counts lap snapshots in their own segment", async () => {
    await putSnapshotRaw(snapshot("s1"));
    const usage = await getLocalStorageUsage();
    expect(usage.snapshots).toBeGreaterThan(0);
    expect(usage.documents).toBe(0);
  });

  it("accounts all three segments together", async () => {
    await getAccessor(STORE_NAMES.KARTS).putOne({ id: "k1", name: "A" });
    await saveFile("run1.dove", new Blob(["abcde"]));
    await putSnapshotRaw(snapshot("s1"));
    const usage = await getLocalStorageUsage();
    expect(usage.documents).toBeGreaterThan(0);
    expect(usage.logs).toBe(5);
    expect(usage.snapshots).toBeGreaterThan(0);
  });
});
