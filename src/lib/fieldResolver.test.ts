import { describe, it, expect } from "vitest";
import {
  getCanonicalFieldId,
  isFieldHiddenByCanonical,
  getFieldAliases,
  FIELD_CATEGORIES,
} from "./fieldResolver";

// fieldResolver is the settings-facing adapter over the canonical channel
// registry (channels.ts). It resolves display names / aliases / already-canonical
// ids to a ChannelId and drives the field-default hide/show.

// ─── getCanonicalFieldId ────────────────────────────────────────────────────

describe("getCanonicalFieldId", () => {
  it("passes through an already-canonical id unchanged", () => {
    expect(getCanonicalFieldId("rpm")).toBe("rpm");
    expect(getCanonicalFieldId("lat_g")).toBe("lat_g");
  });

  it("resolves a canonical display label to its id (case-insensitive)", () => {
    expect(getCanonicalFieldId("RPM")).toBe("rpm");
    expect(getCanonicalFieldId("Water Temp")).toBe("water_temp");
    expect(getCanonicalFieldId("  Throttle  ")).toBe("throttle");
  });

  it("resolves a registered alias to its id", () => {
    expect(getCanonicalFieldId("Lateral G")).toBe("lat_g");
    expect(getCanonicalFieldId("Engine RPM")).toBe("rpm");
    expect(getCanonicalFieldId("Coolant Temp")).toBe("water_temp");
    expect(getCanonicalFieldId("TPS")).toBe("throttle");
  });

  it("returns undefined for an unknown field name", () => {
    expect(getCanonicalFieldId("Brake Bias Wizardry")).toBeUndefined();
  });

  it("returns undefined for a custom: slug (not a canonical id)", () => {
    expect(getCanonicalFieldId("custom:gizmo_voltage")).toBeUndefined();
  });
});

// ─── isFieldHiddenByCanonical ────────────────────────────────────────────────

describe("isFieldHiddenByCanonical", () => {
  it("returns true when the field's canonical id is in the hidden list", () => {
    expect(isFieldHiddenByCanonical("rpm", ["rpm", "egt"])).toBe(true);
  });

  it("matches by canonical id even when given a display name or alias", () => {
    // "Engine RPM" resolves to rpm, which is hidden
    expect(isFieldHiddenByCanonical("Engine RPM", ["rpm"])).toBe(true);
    expect(isFieldHiddenByCanonical("Lateral G", ["lat_g"])).toBe(true);
  });

  it("returns false when the canonical id is not hidden", () => {
    expect(isFieldHiddenByCanonical("rpm", ["egt", "water_temp"])).toBe(false);
  });

  it("returns false for an unknown field name (no canonical mapping)", () => {
    // unknown field → undefined canonical → not hidden, even if list is non-empty
    expect(isFieldHiddenByCanonical("Mystery Channel", ["rpm"])).toBe(false);
  });

  it("returns false against an empty hidden list", () => {
    expect(isFieldHiddenByCanonical("rpm", [])).toBe(false);
  });
});

// ─── getFieldAliases ────────────────────────────────────────────────────────

describe("getFieldAliases", () => {
  it("returns the label followed by registered aliases", () => {
    const aliases = getFieldAliases("rpm");
    expect(aliases[0]).toBe("RPM"); // label first
    expect(aliases).toContain("Engine RPM");
    expect(aliases).toContain("Rpm");
  });

  it("returns just the label when a channel has no aliases", () => {
    // accel_x has an empty aliases array
    expect(getFieldAliases("accel_x")).toEqual(["Accel X"]);
  });

  it("includes label + aliases for lat_g", () => {
    const aliases = getFieldAliases("lat_g");
    expect(aliases).toContain("Lat G");
    expect(aliases).toContain("Lateral G");
  });
});

// ─── FIELD_CATEGORIES ────────────────────────────────────────────────────────

describe("FIELD_CATEGORIES", () => {
  it("groups fields under named categories", () => {
    const names = FIELD_CATEGORIES.map((c) => c.category);
    expect(names).toEqual(["GPS Data", "Computed", "Sensors"]);
  });

  it("every field references a real canonical id resolvable back to itself", () => {
    for (const cat of FIELD_CATEGORIES) {
      for (const f of cat.fields) {
        // canonicalId must be a known channel id
        expect(getCanonicalFieldId(f.canonicalId)).toBe(f.canonicalId);
        expect(f.label.length).toBeGreaterThan(0);
        expect(f.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("places computed g-force ids in the Computed category", () => {
    const computed = FIELD_CATEGORIES.find((c) => c.category === "Computed");
    const ids = computed?.fields.map((f) => f.canonicalId) ?? [];
    expect(ids).toContain("lat_g");
    expect(ids).toContain("lon_g");
  });

  it("has no duplicate canonical ids across categories", () => {
    const ids = FIELD_CATEGORIES.flatMap((c) => c.fields.map((f) => f.canonicalId));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
