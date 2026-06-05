/**
 * IndexedDB round-trip tests for graphPrefsStorage (the pure migrateGraphPrefs
 * helper is covered in graphPrefsStorage.test.ts). Covers save/load/delete and
 * that load applies channel-key migration to persisted records.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  saveGraphPrefs,
  loadGraphPrefs,
  deleteGraphPrefs,
} from "./graphPrefsStorage";

beforeEach(() => freshIndexedDB());

describe("graphPrefsStorage round-trip", () => {
  it("returns empty prefs when nothing is stored for the session", async () => {
    expect(await loadGraphPrefs("none.dove")).toEqual({ activeGraphs: [], graphHeights: {} });
  });

  it("saves and loads active graphs + heights for a session", async () => {
    await saveGraphPrefs("s.dove", ["speed", "rpm"], { speed: 120, rpm: 90 });
    const prefs = await loadGraphPrefs("s.dove");
    expect(prefs.activeGraphs).toContain("speed");
    expect(prefs.activeGraphs).toContain("rpm");
    expect(prefs.graphHeights.speed).toBe(120);
  });

  it("is scoped per session file name", async () => {
    await saveGraphPrefs("a.dove", ["speed"], {});
    await saveGraphPrefs("b.dove", ["rpm"], {});
    expect((await loadGraphPrefs("a.dove")).activeGraphs).toEqual(["speed"]);
    expect((await loadGraphPrefs("b.dove")).activeGraphs).toEqual(["rpm"]);
  });

  it("migrates legacy display-name keys to canonical channel ids on load", async () => {
    // "Lat G" is a legacy display name; load() runs it through migrateGraphPrefs.
    await saveGraphPrefs("s.dove", ["Lat G"], { "Lat G": 80 });
    const prefs = await loadGraphPrefs("s.dove");
    expect(prefs.activeGraphs).toEqual(["lat_g"]);
    expect(prefs.graphHeights.lat_g).toBe(80);
  });

  it("deletes a session's prefs", async () => {
    await saveGraphPrefs("s.dove", ["speed"], {});
    await deleteGraphPrefs("s.dove");
    expect(await loadGraphPrefs("s.dove")).toEqual({ activeGraphs: [], graphHeights: {} });
  });
});
