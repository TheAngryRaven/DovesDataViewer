import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "@/lib/__test__/idb";
import { STORE_NAMES } from "@/lib/dbUtils";
import { TRACKS_SYNC_STORE } from "@/lib/trackStorage";
import { getAccessor } from "./storeAccessors";
import { addSetupRevisionTombstone } from "./setupRevisionTombstones";
import { setActiveUserId } from "./activeUser";

// Minimal in-memory localStorage — the tracks accessor is localStorage-backed
// (trackStorage), and node doesn't ship one. Fresh per test for isolation.
function installLocalStorage(): void {
  const map = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  freshIndexedDB();
  installLocalStorage();
  setActiveUserId(null);
});

describe("idb accessor (the default for most stores)", () => {
  it("writes, reads one, and reads all via the IndexedDB store", async () => {
    const acc = getAccessor(STORE_NAMES.KARTS);
    await acc.putOne({ id: "k1", name: "A" });
    await acc.putOne({ id: "k2", name: "B" });
    expect(await acc.getOne("k1")).toMatchObject({ id: "k1", name: "A" });
    expect((await acc.readAll()).map((r) => r.id).sort()).toEqual(["k1", "k2"]);
  });

  it("returns undefined for a missing key", async () => {
    expect(await getAccessor(STORE_NAMES.KARTS).getOne("nope")).toBeUndefined();
  });

  it("memoizes one accessor per store", () => {
    expect(getAccessor(STORE_NAMES.NOTES)).toBe(getAccessor(STORE_NAMES.NOTES));
  });
});

describe("tracks accessor (localStorage-backed override)", () => {
  // trackStorage only persists user-defined tracks — which is exactly what the
  // cloud-sync tracks accessor handles, so the fixture mirrors that. Typed as a
  // plain record to match the accessor's putOne signature (it casts to Track).
  const track = (name: string): Record<string, unknown> => ({
    name,
    courses: [],
    isUserDefined: true,
  });

  it("round-trips user tracks through trackStorage, keyed by name", async () => {
    const acc = getAccessor(TRACKS_SYNC_STORE);
    await acc.putOne(track("Local Park"));
    await acc.putOne(track("Backyard"));
    expect(await acc.getOne("Local Park")).toMatchObject({ name: "Local Park" });
    expect((await acc.readAll()).map((t) => t.name).sort()).toEqual(["Backyard", "Local Park"]);
  });

  it("upserts in place on a repeat name (no duplicate)", async () => {
    const acc = getAccessor(TRACKS_SYNC_STORE);
    await acc.putOne(track("Local Park"));
    await acc.putOne({ ...track("Local Park"), shortName: "LP" });
    const all = await acc.readAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: "Local Park", shortName: "LP" });
  });
});

describe("setup-revisions accessor (tombstone-aware pull)", () => {
  it("writes a normal (non-tombstoned) revision", async () => {
    const acc = getAccessor(STORE_NAMES.SETUP_REVISIONS);
    await acc.putOne({ id: "hash-1", setupId: "s1" });
    expect(await acc.getOne("hash-1")).toMatchObject({ id: "hash-1" });
  });

  it("skips re-pulling a locally-pruned (tombstoned) revision so the orphan sweep stands", async () => {
    await addSetupRevisionTombstone("hash-1");
    const acc = getAccessor(STORE_NAMES.SETUP_REVISIONS);
    await acc.putOne({ id: "hash-1", setupId: "s1" });
    expect(await acc.getOne("hash-1")).toBeUndefined();
  });

  it("still reads straight through (only the write is gated)", async () => {
    // A revision that exists locally is readable even if a (different) id is tombstoned.
    await addSetupRevisionTombstone("hash-other");
    const acc = getAccessor(STORE_NAMES.SETUP_REVISIONS);
    await acc.putOne({ id: "hash-keep", setupId: "s2" });
    expect(await acc.getOne("hash-keep")).toMatchObject({ id: "hash-keep" });
  });
});
