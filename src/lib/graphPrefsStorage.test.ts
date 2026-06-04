import { describe, it, expect } from "vitest";
import { migrateGraphPrefs } from "./graphPrefsStorage";

describe("migrateGraphPrefs", () => {
  it("returns empty prefs for a missing record", () => {
    expect(migrateGraphPrefs(undefined)).toEqual({
      activeGraphs: [],
      graphHeights: {},
    });
  });

  it("defaults graphHeights to an empty map for legacy records without it", () => {
    const result = migrateGraphPrefs({
      sessionFileName: "run.dove",
      activeGraphs: ["speed"],
    });
    expect(result).toEqual({ activeGraphs: ["speed"], graphHeights: {} });
  });

  it("migrates legacy display-name keys in both lists and the height map", () => {
    const result = migrateGraphPrefs({
      sessionFileName: "run.dove",
      activeGraphs: ["speed", "Lat G", "Gizmo Voltage"],
      graphHeights: { "Lat G": 300, "Gizmo Voltage": 220 },
    });
    expect(result.activeGraphs).toEqual(["speed", "lat_g", "custom:gizmo_voltage"]);
    expect(result.graphHeights).toEqual({
      lat_g: 300,
      "custom:gizmo_voltage": 220,
    });
  });

  it("leaves synthetic keys (speed / __pace__) untouched in the height map", () => {
    const result = migrateGraphPrefs({
      sessionFileName: "run.dove",
      activeGraphs: ["speed", "__pace__"],
      graphHeights: { speed: 200, __pace__: 160 },
    });
    expect(result.graphHeights).toEqual({ speed: 200, __pace__: 160 });
  });
});
