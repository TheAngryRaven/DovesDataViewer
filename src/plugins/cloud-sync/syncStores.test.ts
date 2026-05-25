import { describe, it, expect } from "vitest";
import { STORE_NAMES } from "@/lib/dbUtils";
import { TRACKS_SYNC_STORE } from "@/lib/trackStorage";
import { extractKey, DOC_STORES, FILE_STORE } from "./syncStores";

describe("extractKey", () => {
  it("uses each store's IndexedDB key path", () => {
    expect(extractKey(STORE_NAMES.METADATA, { fileName: "run1.dovex" })).toBe("run1.dovex");
    expect(extractKey(STORE_NAMES.KARTS, { id: "kart-7" })).toBe("kart-7");
    expect(extractKey(STORE_NAMES.GRAPH_PREFS, { sessionFileName: "run1.dovex" })).toBe("run1.dovex");
    expect(extractKey(STORE_NAMES.FILES, { name: "run1.dovex" })).toBe("run1.dovex");
  });

  it("coerces non-string keys to string", () => {
    expect(extractKey(STORE_NAMES.NOTES, { id: 42 })).toBe("42");
  });

  it("keys user tracks by name", () => {
    expect(extractKey(TRACKS_SYNC_STORE, { name: "Local Kart Track" })).toBe("Local Kart Track");
  });
});

describe("synced store coverage", () => {
  it("syncs files separately from the jsonb document stores", () => {
    expect(FILE_STORE).toBe(STORE_NAMES.FILES);
    expect(DOC_STORES).not.toContain(STORE_NAMES.FILES);
  });

  it("does not sync video stores (out of scope, large blobs)", () => {
    expect(DOC_STORES).not.toContain(STORE_NAMES.SESSION_VIDEOS);
    expect(DOC_STORES).not.toContain(STORE_NAMES.VIDEO_SYNC);
  });

  it("covers garage data: vehicles, setups, notes, graph prefs, and their templates", () => {
    for (const store of [
      STORE_NAMES.KARTS,
      STORE_NAMES.SETUPS,
      STORE_NAMES.NOTES,
      STORE_NAMES.GRAPH_PREFS,
      STORE_NAMES.VEHICLE_TYPES,
      STORE_NAMES.SETUP_TEMPLATES,
      STORE_NAMES.METADATA,
      TRACKS_SYNC_STORE,
    ]) {
      expect(DOC_STORES).toContain(store);
    }
  });
});
