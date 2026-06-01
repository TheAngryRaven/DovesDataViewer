import { describe, it, expect } from "vitest";
import type { ParsedData, FieldMapping, GpsSample } from "@/types/racing";
import {
  CHANNELS,
  channelKeyFor,
  channelLabel,
  channelUnit,
  customChannelId,
  isKnownChannel,
  normalizeChannels,
  resolveChannelId,
  toChannelKey,
} from "./channels";

describe("channel registry", () => {
  it("has unique ids", () => {
    const ids = CHANNELS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves a canonical label to its id (case-insensitive, trimmed)", () => {
    expect(resolveChannelId("RPM")).toBe("rpm");
    expect(resolveChannelId("  rpm  ")).toBe("rpm");
    expect(resolveChannelId("Water Temp")).toBe("water_temp");
  });

  it("resolves known aliases to the canonical id", () => {
    expect(resolveChannelId("Lateral G")).toBe("lat_g");
    expect(resolveChannelId("Engine RPM")).toBe("rpm");
    expect(resolveChannelId("Altitude (m)")).toBe("altitude");
    expect(resolveChannelId("H Acc M")).toBe("h_acc");
  });

  it("keeps measured, native, and raw-IMU g as distinct ids (never collapses)", () => {
    expect(resolveChannelId("Lat G")).toBe("lat_g");
    expect(resolveChannelId("Lat G (Native)")).toBe("lat_g_native");
    expect(resolveChannelId("Accel X")).toBe("accel_x");
    // The three are genuinely different channels that can coexist on one sample.
    const ids = new Set(["lat_g", "lat_g_native", "accel_x"]);
    expect(ids.size).toBe(3);
  });

  it("returns undefined for an unknown name", () => {
    expect(resolveChannelId("Brake Bias Wizardry")).toBeUndefined();
  });

  it("exposes labels and units", () => {
    expect(channelLabel("lat_g")).toBe("Lat G");
    expect(channelUnit("altitude")).toBe("m");
    expect(channelUnit("satellites")).toBeUndefined();
  });

  it("recognises known ids", () => {
    expect(isKnownChannel("rpm")).toBe(true);
    expect(isKnownChannel("custom:foo")).toBe(false);
  });

  it("slugs unknown columns into a collision-proof custom key", () => {
    expect(customChannelId("My Weird Sensor!")).toBe("custom:my_weird_sensor");
    expect(customChannelId("  --  ")).toBe("custom:field");
    // A custom slug can never look like a canonical id.
    expect(isKnownChannel(customChannelId("RPM-ish"))).toBe(false);
  });

  it("channelKeyFor yields the canonical id when known, else a custom slug", () => {
    expect(channelKeyFor("Lon G")).toBe("lon_g");
    expect(channelKeyFor("Gizmo Voltage")).toBe("custom:gizmo_voltage");
  });
});

describe("toChannelKey (idempotent migration)", () => {
  it("resolves a legacy display name to its canonical id", () => {
    expect(toChannelKey("Lat G")).toBe("lat_g");
    expect(toChannelKey("Gizmo Voltage")).toBe("custom:gizmo_voltage");
  });

  it("leaves already-migrated keys untouched (idempotent)", () => {
    expect(toChannelKey("lat_g")).toBe("lat_g");
    expect(toChannelKey("custom:gizmo_voltage")).toBe("custom:gizmo_voltage");
    expect(toChannelKey(toChannelKey("Lat G"))).toBe("lat_g");
    expect(toChannelKey(toChannelKey("Gizmo Voltage"))).toBe("custom:gizmo_voltage");
  });
});

describe("normalizeChannels", () => {
  function sample(extra: Record<string, number>): GpsSample {
    return {
      t: 0,
      lat: 0,
      lon: 0,
      speedMps: 0,
      speedMph: 0,
      speedKph: 0,
      extraFields: extra,
    };
  }

  function data(mappings: FieldMapping[], samples: GpsSample[]): ParsedData {
    return {
      samples,
      fieldMappings: mappings,
      bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
      duration: 0,
    };
  }

  it("renames mappings and sample keys to canonical ids and sets labels", () => {
    const out = normalizeChannels(
      data(
        [
          { index: -10, name: "Lat G", enabled: true },
          { index: -20, name: "RPM", enabled: true },
        ],
        [sample({ "Lat G": 0.5, RPM: 9000 })],
      ),
    );
    expect(out.fieldMappings.map((m) => m.name)).toEqual(["lat_g", "rpm"]);
    expect(out.fieldMappings[0].label).toBe("Lat G");
    expect(out.samples[0].extraFields).toEqual({ lat_g: 0.5, rpm: 9000 });
  });

  it("keeps native, derived, and raw-IMU g as separate keys on one sample", () => {
    const out = normalizeChannels(
      data(
        [
          { index: -10, name: "Lat G", enabled: true },
          { index: -12, name: "Lat G (Native)", enabled: true },
          { index: -30, name: "Accel X", unit: "G", enabled: true },
        ],
        [sample({ "Lat G": 0.5, "Lat G (Native)": 0.48, "Accel X": 0.51 })],
      ),
    );
    expect(out.samples[0].extraFields).toEqual({
      lat_g: 0.5,
      lat_g_native: 0.48,
      accel_x: 0.51,
    });
    // A pre-set unit is preserved over the registry default.
    expect(out.fieldMappings.find((m) => m.name === "accel_x")!.unit).toBe("G");
  });

  it("preserves unmapped custom columns under a stable custom key", () => {
    const out = normalizeChannels(
      data(
        [{ index: 5, name: "Gizmo Voltage", enabled: true }],
        [sample({ "Gizmo Voltage": 12.6 })],
      ),
    );
    expect(out.fieldMappings[0].name).toBe("custom:gizmo_voltage");
    expect(out.fieldMappings[0].label).toBe("Gizmo Voltage");
    expect(out.samples[0].extraFields).toEqual({ "custom:gizmo_voltage": 12.6 });
  });

  it("is idempotent — re-normalizing already-canonical data is a no-op", () => {
    const once = normalizeChannels(
      data(
        [{ index: -10, name: "Lat G", enabled: true }],
        [sample({ "Lat G": 0.5 })],
      ),
    );
    const twice = normalizeChannels(once);
    expect(twice.fieldMappings.map((m) => m.name)).toEqual(["lat_g"]);
    expect(twice.samples[0].extraFields).toEqual({ lat_g: 0.5 });
  });
});
