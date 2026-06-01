import { describe, it, expect } from "vitest";
import {
  DEVICE_SETTINGS_SCHEMA,
  getSettingDef,
  validateSettingValue,
} from "./deviceSettingsSchema";

// ─── schema shape ─────────────────────────────────────────────────────────────

describe("DEVICE_SETTINGS_SCHEMA", () => {
  it("has unique keys", () => {
    const keys = DEVICE_SETTINGS_SCHEMA.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every def has a non-empty label and a valid type", () => {
    for (const d of DEVICE_SETTINGS_SCHEMA) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(["string", "number"]).toContain(d.type);
    }
  });

  it("includes the known device keys", () => {
    const keys = DEVICE_SETTINGS_SCHEMA.map((d) => d.key);
    expect(keys).toContain("bluetooth_name");
    expect(keys).toContain("bluetooth_pin");
    expect(keys).toContain("lap_detection_distance");
    expect(keys).toContain("use_legacy_csv");
  });
});

// ─── getSettingDef ──────────────────────────────────────────────────────────

describe("getSettingDef", () => {
  it("returns the def for a known key", () => {
    const def = getSettingDef("driver_name");
    expect(def).not.toBeNull();
    expect(def?.label).toBe("Driver Name");
    expect(def?.type).toBe("string");
    expect(def?.maxLength).toBe(30);
  });

  it("returns null for an unknown key", () => {
    expect(getSettingDef("nonexistent_key")).toBeNull();
  });

  it("is case-sensitive (does not match wrong casing)", () => {
    expect(getSettingDef("BLUETOOTH_NAME")).toBeNull();
  });
});

// ─── validateSettingValue: unknown keys ─────────────────────────────────────

describe("validateSettingValue — unknown keys", () => {
  it("returns null (no validation) for unknown keys, even garbage values", () => {
    expect(validateSettingValue("mystery", "anything at all")).toBeNull();
    expect(validateSettingValue("mystery", "")).toBeNull();
  });
});

// ─── validateSettingValue: number type ──────────────────────────────────────

describe("validateSettingValue — number fields", () => {
  it("accepts an in-range integer", () => {
    expect(validateSettingValue("lap_detection_distance", "25")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(validateSettingValue("lap_detection_distance", "abc")).toBe(
      "Must be a whole number"
    );
  });

  it("rejects a fractional value (whole numbers only)", () => {
    expect(validateSettingValue("lap_detection_distance", "10.5")).toBe(
      "Must be a whole number"
    );
  });

  it("enforces the minimum", () => {
    // lap_detection_distance min = 1
    expect(validateSettingValue("lap_detection_distance", "0")).toBe(
      "Minimum value is 1"
    );
  });

  it("enforces the maximum", () => {
    // lap_detection_distance max = 50
    expect(validateSettingValue("lap_detection_distance", "51")).toBe(
      "Maximum value is 50"
    );
  });

  it("accepts the exact boundary values", () => {
    expect(validateSettingValue("lap_detection_distance", "1")).toBeNull();
    expect(validateSettingValue("lap_detection_distance", "50")).toBeNull();
  });

  it("accepts a negative integer when min allows it (use_legacy_csv min 0 still 0)", () => {
    // use_legacy_csv: 0 and 1 valid, 2 too big, -1 below min
    expect(validateSettingValue("use_legacy_csv", "0")).toBeNull();
    expect(validateSettingValue("use_legacy_csv", "1")).toBeNull();
    expect(validateSettingValue("use_legacy_csv", "2")).toBe("Maximum value is 1");
    expect(validateSettingValue("use_legacy_csv", "-1")).toBe("Minimum value is 0");
  });

  it("enforces maxLength (digit count) on numeric fields like bluetooth_pin", () => {
    // bluetooth_pin: min 0, max 9999, maxLength 4
    expect(validateSettingValue("bluetooth_pin", "1234")).toBeNull();
    // 5 digits: caught by max (9999) before maxLength
    expect(validateSettingValue("bluetooth_pin", "12345")).toBe(
      "Maximum value is 9999"
    );
  });

  it("treats empty string as 0 (Number('') === 0) and applies range", () => {
    // Number("") is 0, which is an integer; for lap_detection_distance min 1 → fails
    expect(validateSettingValue("lap_detection_distance", "")).toBe(
      "Minimum value is 1"
    );
  });
});

// ─── validateSettingValue: string type ──────────────────────────────────────

describe("validateSettingValue — string fields", () => {
  it("accepts a short string", () => {
    expect(validateSettingValue("driver_name", "Mike")).toBeNull();
  });

  it("accepts an empty string (no min length)", () => {
    expect(validateSettingValue("driver_name", "")).toBeNull();
  });

  it("accepts exactly maxLength characters", () => {
    expect(validateSettingValue("driver_name", "x".repeat(30))).toBeNull();
  });

  it("rejects a string over maxLength", () => {
    expect(validateSettingValue("driver_name", "x".repeat(31))).toBe(
      "Maximum 30 characters"
    );
  });

  it("does not apply numeric validation to string fields", () => {
    // bluetooth_name is a string — non-numeric content is fine
    expect(validateSettingValue("bluetooth_name", "My Logger!")).toBeNull();
  });
});
